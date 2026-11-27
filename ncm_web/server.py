#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ncm_web 本機伺服器

  python3 server.py            # 監聽 127.0.0.1:8787
  NCM_PORT=8788 python3 server.py

職責
  - 靜態託管 index.html（播放頁，已內含前端邏輯與二維碼產生器）/ remote.html / av/*
  - /api/unikey      取二維碼登入 key
  - /api/check       查詢掃碼狀態（800 過期 / 801 等待 / 802 待確認 / 803 成功）
  - /api/status      目前登入帳號
  - /api/cookie      手動貼上 MUSIC_U（掃碼被風控時的備援）
  - /api/logout      清除登入態
  - /api/search      搜尋單曲
  - /api/playurl     取播放地址
  - /api/lyric       取歌詞
  - /api/nowplaying  GET 讀取 / POST 同步目前播放
  - /api/remote      GET 取遙控指令 / POST 送出遙控指令

只用 Python 標準函式庫（AES 為純 Python 實作），不需要 pip 安裝任何套件。
這是非官方介面，僅供個人帳號自用；介面可能隨時變動或被風控。
"""

import base64
import json
import os
import random
import string
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

try:
    from http.server import ThreadingHTTPServer
except ImportError:  # Python < 3.7
    import socketserver
    from http.server import HTTPServer

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True

HOST = "127.0.0.1"
PORT = int(os.environ.get("NCM_PORT", "8787"))
ROOT = os.path.dirname(os.path.abspath(__file__))
COOKIE_FILE = os.path.join(ROOT, "cookie.txt")
AV_DIR = os.path.join(ROOT, "av")

# 允許跨來源呼叫的網頁（餘溫 App 本體）。它們只能用 CORS_PATHS 裡的接口：
# 也就是只能確認伺服器在不在；其餘接口（含登入、Cookie）一律只限本頁。
CORS_ORIGINS = set(
    o.strip().rstrip("/")
    for o in os.environ.get(
        "NCM_ALLOW_ORIGINS",
        "https://watermelon0307.github.io,https://localhost,capacitor://localhost",
    ).split(",")
    if o.strip()
)
FRAME_ANCESTORS = " ".join(sorted(CORS_ORIGINS) + ["http://localhost:*", "http://127.0.0.1:*"])
CORS_PATHS = ("/api/status",)

STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/remote.html": "remote.html",
}
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# ───────────────────────── AES-128-CBC（純 Python） ─────────────────────────


def _rotl8(x, n):
    return ((x << n) | (x >> (8 - n))) & 0xFF


def _build_sbox():
    sbox = [0] * 256
    p = q = 1
    while True:
        p = (p ^ (p << 1) ^ (0x1B if p & 0x80 else 0)) & 0xFF
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        sbox[p] = q ^ _rotl8(q, 1) ^ _rotl8(q, 2) ^ _rotl8(q, 3) ^ _rotl8(q, 4) ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


_SBOX = _build_sbox()
_XT = [((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1 for a in range(256)]


def _expand_key(key):
    if len(key) != 16:
        raise ValueError("AES key must be 16 bytes")
    w = [list(key[i:i + 4]) for i in range(0, 16, 4)]
    rcon = 1
    for i in range(4, 44):
        t = list(w[i - 1])
        if i % 4 == 0:
            t = [_SBOX[t[1]] ^ rcon, _SBOX[t[2]], _SBOX[t[3]], _SBOX[t[0]]]
            rcon = _XT[rcon]
        w.append([w[i - 4][j] ^ t[j] for j in range(4)])
    return [sum(w[r * 4:r * 4 + 4], []) for r in range(11)]


_SHIFT = [0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11]


def _encrypt_block(block, rks):
    s = [b ^ k for b, k in zip(block, rks[0])]
    for rnd in range(1, 11):
        s = [_SBOX[s[i]] for i in _SHIFT]
        if rnd < 10:
            m = []
            for c in range(0, 16, 4):
                a0, a1, a2, a3 = s[c:c + 4]
                x = a0 ^ a1 ^ a2 ^ a3
                m += [
                    a0 ^ x ^ _XT[a0 ^ a1],
                    a1 ^ x ^ _XT[a1 ^ a2],
                    a2 ^ x ^ _XT[a2 ^ a3],
                    a3 ^ x ^ _XT[a3 ^ a0],
                ]
            s = m
        s = [b ^ k for b, k in zip(s, rks[rnd])]
    return s


def aes_cbc_encrypt(data, key, iv):
    """AES-128-CBC + PKCS7，回傳 bytes。"""
    rks = _expand_key(key)
    pad = 16 - len(data) % 16
    data = bytes(data) + bytes([pad]) * pad
    prev = list(iv)
    out = bytearray()
    for i in range(0, len(data), 16):
        prev = _encrypt_block([data[i + j] ^ prev[j] for j in range(16)], rks)
        out += bytes(prev)
    return bytes(out)


# ───────────────────────────── weapi 加密 ─────────────────────────────

_PRESET_KEY = b"0CoJUm6Qyw8W8jud"
_IV = b"0102030405060708"
_RSA_E = 0x010001
_RSA_N = int(
    "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725"
    "152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312"
    "ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424"
    "d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8"
    "e7",
    16,
)
_ALNUM = string.ascii_letters + string.digits


def weapi(obj, sec_key=None):
    """把請求物件加密成 {params, encSecKey}。"""
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if sec_key is None:
        rng = random.SystemRandom()
        sec_key = "".join(rng.choice(_ALNUM) for _ in range(16))
    sec = sec_key.encode("ascii")
    first = base64.b64encode(aes_cbc_encrypt(text, _PRESET_KEY, _IV))
    params = base64.b64encode(aes_cbc_encrypt(first, sec, _IV)).decode("ascii")
    enc = pow(int.from_bytes(sec[::-1], "big"), _RSA_E, _RSA_N)
    return {"params": params, "encSecKey": format(enc, "0256x")}


# ───────────────────────────── Cookie 登入態 ─────────────────────────────


class CookieJar:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.data = {}
        self.load()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                raw = f.read().strip()
        except OSError:
            raw = ""
        with self.lock:
            self.data = self.parse(raw)
            self._defaults()

    @staticmethod
    def parse(raw):
        raw = (raw or "").strip().strip('"').strip()
        if raw.lower().startswith("cookie:"):
            raw = raw[7:].strip()
        if not raw:
            return {}
        if "=" not in raw:  # 只貼了 MUSIC_U 的值
            return {"MUSIC_U": raw} if len(raw) >= 32 else {}
        out = {}
        for part in raw.replace("\n", ";").split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                k, v = k.strip(), v.strip()
                if k and v:
                    out[k] = v
        return out

    def _defaults(self):
        d = self.data
        d.setdefault("__remember_me", "true")
        d.setdefault("_ntes_nuid", "%032x" % random.getrandbits(128))
        d.setdefault("NMTID", "%032x" % random.getrandbits(128))
        d.setdefault("sDeviceId", "unknown-%d" % random.randrange(1000000))
        d.setdefault("os", "pc")
        d.setdefault("appver", "3.1.17.204416")

    def save(self):
        with self.lock:
            text = "; ".join("%s=%s" % kv for kv in self.data.items())
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass  # /sdcard 不支援權限位元

    def get(self, key, default=""):
        with self.lock:
            return self.data.get(key, default)

    def header(self):
        with self.lock:
            return "; ".join("%s=%s" % kv for kv in self.data.items())

    def absorb(self, set_cookie_headers):
        """吸收回應的 Set-Cookie；有變動才寫檔。"""
        changed = False
        with self.lock:
            for line in set_cookie_headers or []:
                first = line.split(";", 1)[0]
                if "=" not in first:
                    continue
                k, v = first.split("=", 1)
                k, v = k.strip(), v.strip()
                if not k:
                    continue
                if not v or v == "deleted":
                    if k in self.data:
                        del self.data[k]
                        changed = True
                elif self.data.get(k) != v:
                    self.data[k] = v
                    changed = True
        if changed:
            self.save()

    def replace(self, raw):
        parsed = self.parse(raw)
        with self.lock:
            self.data = parsed
            self._defaults()
        self.save()
        return "MUSIC_U" in parsed

    def clear(self):
        with self.lock:
            self.data = {}
            self._defaults()
        self.save()

    def logged_in(self):
        return bool(self.get("MUSIC_U"))


JAR = CookieJar(COOKIE_FILE)

# ───────────────────────────── 上游請求 ─────────────────────────────

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
)


class UpstreamError(Exception):
    pass


def ncm_post(path, data=None, timeout=12):
    """POST https://music.163.com/weapi/...，回傳解析後的 JSON。"""
    payload = dict(data or {})
    csrf = JAR.get("__csrf")
    payload["csrf_token"] = csrf
    body = urllib.parse.urlencode(weapi(payload)).encode("ascii")
    url = "https://music.163.com" + path + "?csrf_token=" + urllib.parse.quote(csrf)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": _UA,
            "Referer": "https://music.163.com/",
            "Origin": "https://music.163.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Cookie": JAR.header(),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            JAR.absorb(resp.headers.get_all("Set-Cookie"))
    except urllib.error.HTTPError as e:
        try:
            snippet = e.read(300).decode("utf-8", "replace")
        except OSError:
            snippet = ""
        sys.stdout.write("%s upstream %s HTTP %s %s\n" % (time.strftime("%H:%M:%S"), path, e.code, snippet))
        sys.stdout.flush()
        raise UpstreamError("網易雲回應 HTTP %s" % e.code)
    except (urllib.error.URLError, OSError) as e:
        raise UpstreamError("連不上網易雲：%s" % getattr(e, "reason", e))
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        raise UpstreamError("網易雲回應不是 JSON（可能被風控）")


def _https(url):
    if url and url.startswith("http://"):
        return "https://" + url[7:]
    return url


# ───────────────────────────── API 實作 ─────────────────────────────


def api_unikey(_q):
    r = ncm_post("/weapi/login/qrcode/unikey", {"type": 1, "noCheckToken": True})
    key = r.get("unikey")
    if not key:
        raise UpstreamError("取不到二維碼 key（code=%s）" % r.get("code"))
    # 參考 pyncm：二維碼連結不帶 chainId 會被登入風控擋下
    chain = "v1_%s_web_login_%d" % (JAR.get("sDeviceId"), int(time.time() * 1000))
    qrurl = "https://music.163.com/login?codekey=%s&chainId=%s" % (key, urllib.parse.quote(chain))
    return {"unikey": key, "qrurl": qrurl}


def api_check(q):
    key = q.get("key", "")
    if not key:
        return {"code": 400, "message": "缺少 key"}
    r = ncm_post("/weapi/login/qrcode/client/login", {"key": key, "type": 1, "noCheckToken": True})
    code = r.get("code")
    out = {"code": code, "message": r.get("message", "")}
    if code == 802:
        out["nickname"] = r.get("nickname", "")
        out["avatarUrl"] = _https(r.get("avatarUrl", ""))
    if code == 803:
        out["loggedIn"] = JAR.logged_in()
    return out


def api_status(_q):
    if not JAR.logged_in():
        return {"loggedIn": False}
    r = ncm_post("/weapi/w/nuser/account/get", {})
    if r.get("code") != 200:  # 風控或上游異常，不代表登入失效
        raise UpstreamError("查不到帳號狀態（code=%s）" % r.get("code"))
    profile = r.get("profile") or {}
    if not profile:
        return {"loggedIn": False, "expired": True}
    return {
        "loggedIn": True,
        "userId": profile.get("userId"),
        "nickname": profile.get("nickname", ""),
        "avatarUrl": _https(profile.get("avatarUrl", "")),
        "vipType": profile.get("vipType", 0),
    }


def api_cookie(_q, body):
    ok = JAR.replace(str(body.get("cookie", "")))
    if not ok:
        return {"ok": False, "message": "內容裡找不到 MUSIC_U"}
    st = api_status({})
    return {"ok": bool(st.get("loggedIn")), "status": st}


def api_logout(_q, _body):
    JAR.clear()
    return {"ok": True}


def _map_song(s, priv=None):
    artists = s.get("ar") or s.get("artists") or []
    album = s.get("al") or s.get("album") or {}
    priv = priv or s.get("privilege") or {}
    return {
        "id": s.get("id"),
        "name": s.get("name", ""),
        "artists": [a.get("name", "") for a in artists],
        "album": album.get("name", ""),
        "cover": _https(album.get("picUrl") or ""),
        "duration": s.get("dt") or s.get("duration") or 0,
        "fee": s.get("fee", 0),
        # st < 0：這個帳號／地區拿不到播放地址（下架、版權或地區限制）
        "noCopyright": priv.get("st", 0) < 0,
    }


def _song_details(ids):
    """補抓封面與版權資訊，回傳 {id: (song, privilege)}。"""
    if not ids:
        return {}
    r = ncm_post("/weapi/v3/song/detail", {"c": json.dumps([{"id": i} for i in ids])})
    privs = {p.get("id"): p for p in r.get("privileges") or []}
    return {s.get("id"): (s, privs.get(s.get("id"))) for s in r.get("songs") or []}


# 依序嘗試；實測（2026-11）cloudsearch/pc 可用且帶封面與版權資訊，
# cloudsearch/get/web 會回 50000005，search/get 可用但沒有封面。
_SEARCH_PATHS = ("/weapi/cloudsearch/pc", "/weapi/cloudsearch/get/web", "/weapi/search/get")


def api_search(q):
    kw = q.get("q", "").strip()
    if not kw:
        return {"songs": [], "total": 0}
    limit = max(1, min(int(q.get("limit", 30) or 30), 50))
    offset = max(0, int(q.get("offset", 0) or 0))
    data = {"s": kw, "type": 1, "limit": limit, "offset": offset, "total": True}
    r, result = {}, {}
    for path in _SEARCH_PATHS:
        r = ncm_post(path, data)
        result = r.get("result") or {}
        if r.get("code") == 200 and isinstance(result, dict):
            break
    else:
        raise UpstreamError("搜尋失敗（code=%s）" % r.get("code"))
    raw = result.get("songs") or []
    detail = {}
    if raw and not any((s.get("al") or {}).get("picUrl") for s in raw):
        try:  # 舊介面沒有封面：補抓一次，失敗就照原樣回傳
            detail = _song_details([s.get("id") for s in raw])
        except UpstreamError:
            detail = {}
    songs = [_map_song(*detail.get(s.get("id"), (s, None))) for s in raw]
    return {"songs": songs, "total": result.get("songCount") or len(songs)}


_LEVELS = ("standard", "higher", "exhigh", "lossless")
_LEVEL_BR = {"standard": 128000, "higher": 192000, "exhigh": 320000, "lossless": 999000}


def api_playurl(q):
    sid = str(q.get("id", "")).strip()
    if not sid.isdigit():
        return {"url": None, "message": "id 不正確"}
    level = q.get("level", "exhigh")
    if level not in _LEVELS:
        level = "exhigh"
    r = ncm_post(
        "/weapi/song/enhance/player/url/v1",
        {"ids": "[%s]" % sid, "level": level, "encodeType": "mp3"},
    )
    item = (r.get("data") or [{}])[0]
    # 實測：這首拿不到地址時 v1 會回 code 200 + 單曲 code 404，舊介面結果相同，
    # 所以只有 v1 整個失敗才改問舊介面，省一次上游請求
    if not item.get("url") and (r.get("code") != 200 or not r.get("data")):
        r2 = ncm_post(
            "/weapi/song/enhance/player/url",
            {"ids": "[%s]" % sid, "br": _LEVEL_BR[level]},
        )
        item2 = (r2.get("data") or [{}])[0]
        if item2.get("url"):
            item = item2
    url = _https(item.get("url"))
    out = {
        "id": int(sid),
        "url": url,
        "br": item.get("br"),
        "type": item.get("type"),
        "level": item.get("level"),
        "freeTrial": bool(item.get("freeTrialInfo")),
    }
    if not url:
        if item.get("fee") in (1, 4):
            out["message"] = "這首需要 VIP 或單獨購買"
        elif not JAR.logged_in():
            out["message"] = "取不到播放地址：尚未登入，或這首有版權／地區限制"
        else:
            out["message"] = "這首暫時無法播放（版權或地區限制）"
    return out


def api_lyric(q):
    sid = str(q.get("id", "")).strip()
    if not sid.isdigit():
        return {"lrc": "", "tlyric": ""}
    r = ncm_post("/weapi/song/lyric", {"id": int(sid), "lv": -1, "tv": -1, "kv": -1, "os": "pc"})
    return {
        "lrc": (r.get("lrc") or {}).get("lyric", "") or "",
        "tlyric": (r.get("tlyric") or {}).get("lyric", "") or "",
        "pure": bool(r.get("pureMusic") or r.get("nolyric")),
    }


# 目前播放 / 遙控（存在記憶體）
_state_lock = threading.Lock()
_now = {"playing": False, "updatedAt": 0}
_cmds = []  # [{"seq": n, "cmd": ..., "value": ...}]
_seq = 0
_NOW_KEYS = ("id", "name", "artists", "album", "cover", "position", "duration", "playing", "lyric")
_CMDS = ("toggle", "play", "pause", "next", "prev", "seek", "volume")


def api_nowplaying_get(_q):
    with _state_lock:
        out = dict(_now)
    # 用伺服器時間補上播放中的進度，讀取端不必自己推算
    if out.get("playing") and out.get("updatedAt"):
        pos = float(out.get("position") or 0) + (time.time() - out["updatedAt"])
        dur = float(out.get("duration") or 0)
        out["position"] = round(min(pos, dur) if dur else pos, 2)
    return out


def api_nowplaying_post(_q, body):
    clean = {k: body[k] for k in _NOW_KEYS if k in body}
    clean["updatedAt"] = time.time()
    with _state_lock:
        _now.clear()
        _now.update(clean)
    return {"ok": True}


def api_remote_get(q):
    since = int(q.get("since", -1) or -1)
    with _state_lock:
        if since < 0:  # 第一次連線：只回目前序號，不重放舊指令
            return {"seq": _seq, "cmds": []}
        return {"seq": _seq, "cmds": [c for c in _cmds if c["seq"] > since]}


def api_remote_post(_q, body):
    global _seq
    cmd = body.get("cmd")
    if cmd not in _CMDS:
        return {"ok": False, "message": "不支援的指令"}
    with _state_lock:
        _seq += 1
        _cmds.append({"seq": _seq, "cmd": cmd, "value": body.get("value")})
        del _cmds[:-50]
        return {"ok": True, "seq": _seq}


GET_ROUTES = {
    "/api/unikey": api_unikey,
    "/api/check": api_check,
    "/api/status": api_status,
    "/api/search": api_search,
    "/api/playurl": api_playurl,
    "/api/lyric": api_lyric,
    "/api/nowplaying": api_nowplaying_get,
    "/api/remote": api_remote_get,
}
POST_ROUTES = {
    "/api/cookie": api_cookie,
    "/api/logout": api_logout,
    "/api/nowplaying": api_nowplaying_post,
    "/api/remote": api_remote_post,
}

# ───────────────────────────── HTTP 處理 ─────────────────────────────


class Handler(BaseHTTPRequestHandler):
    server_version = "ncm_web/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))
        sys.stdout.flush()

    # 只接受本機來源，擋掉 DNS rebinding 與其他網頁的跨站請求。
    # 回傳 "local"（本頁，全部接口）、"cors"（白名單網頁，限 CORS_PATHS）或 None（拒絕）
    def _access(self):
        self._cors_origin = None
        allowed = ("127.0.0.1:%d" % PORT, "localhost:%d" % PORT)
        if self.headers.get("Host", "") not in allowed:
            return None
        origin = self.headers.get("Origin")
        if not origin or urllib.parse.urlparse(origin).netloc in allowed:
            return "local"
        parsed = urllib.parse.urlparse(origin)
        other_local = parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")
        if origin.rstrip("/") in CORS_ORIGINS or other_local:
            self._cors_origin = origin
            return "cors"
        return None

    def _allowed(self, path):
        access = self._access()
        return access == "local" or (access == "cors" and path in CORS_PATHS)

    def _send(self, status, body, ctype, frameable=False):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if frameable:  # 只有餘溫 App 可以把這一頁嵌成面板
            self.send_header("Content-Security-Policy", "frame-ancestors 'self' " + FRAME_ANCESTORS)
        if getattr(self, "_cors_origin", None):
            self.send_header("Access-Control-Allow-Origin", self._cors_origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _query(self):
        parsed = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        return parsed.path, q

    def _run(self, fn, *args):
        try:
            self._json(fn(*args))
        except UpstreamError as e:
            self._json({"error": str(e)}, 502)
        except (ValueError, TypeError, KeyError) as e:
            self._json({"error": "參數錯誤：%s" % e}, 400)
        except Exception as e:  # 不讓單一請求弄垮伺服器
            self.log_message("ERROR %s: %r", self.path, e)
            self._json({"error": "伺服器內部錯誤"}, 500)

    def _static(self, path):
        if path in STATIC_FILES:
            full = os.path.join(ROOT, STATIC_FILES[path])
        elif path.startswith("/av/"):
            name = os.path.basename(urllib.parse.unquote(path[4:]))
            if os.path.splitext(name)[1].lower() not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                return self._send(404, b"not found", "text/plain")
            full = os.path.join(AV_DIR, name)
        else:
            return self._send(404, b"not found", "text/plain")
        try:
            with open(full, "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404, b"not found", "text/plain")
        ext = os.path.splitext(full)[1].lower()
        self._send(200, body, MIME.get(ext, "application/octet-stream"), frameable=ext == ".html")

    def do_OPTIONS(self):  # CORS 預檢（含 Chrome 的私有網路存取預檢）
        path, _q = self._query()
        if not self._allowed(path):
            self._cors_origin = None
            return self._json({"error": "forbidden"}, 403)
        self.send_response(204)
        if self._cors_origin:
            self.send_header("Access-Control-Allow-Origin", self._cors_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path, q = self._query()
        if not self._allowed(path):
            self._cors_origin = None
            return self._json({"error": "forbidden"}, 403)
        if path in GET_ROUTES:
            return self._run(GET_ROUTES[path], q)
        if path.startswith("/api/"):
            return self._json({"error": "not found"}, 404)
        self._static(path)

    do_HEAD = do_GET

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(min(length, 1 << 20)) if length > 0 else b""
        path, q = self._query()
        if not self._allowed(path):
            self._cors_origin = None
            return self._json({"error": "forbidden"}, 403)
        fn = POST_ROUTES.get(path)
        if not fn:
            return self._json({"error": "not found"}, 404)
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
            if not isinstance(body, dict):
                raise ValueError("body 必須是 JSON 物件")
        except ValueError as e:
            return self._json({"error": "JSON 格式錯誤：%s" % e}, 400)
        self._run(fn, q, body)


def main():
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as e:
        sys.exit("無法監聽 %s:%d：%s（可能已有一個 server.py 在跑）" % (HOST, PORT, e))
    httpd.daemon_threads = True
    print("ncm_web 已啟動：http://%s:%d/  （登入態：%s）" % (HOST, PORT, "有" if JAR.logged_in() else "無"))
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
