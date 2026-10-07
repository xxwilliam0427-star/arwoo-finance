# -*- coding: utf-8 -*-
"""
Arwoo 财务助手 —— 飞书机器人长连接

作用：接收你发给机器人的图片消息，把图片存到本地「飞书收件箱」目录，
      网页端会自动把它们读进来做识别、等你核对入账。

为什么用长连接：飞书的事件订阅默认要一个公网 HTTPS 地址，
长连接模式是由本机主动连出去，所以不需要公网地址、不需要域名。

用法：
    python feishu_bot.py --config data/feishu.json

配置文件格式（由网页端写入）：
    { "appId": "...", "appSecret": "...", "outDir": "D:/.../data/feishu-inbox" }

往 stdout 输出的每行都是一个 JSON 状态，Node 端据此显示连接情况。
"""

import argparse
import ctypes
import json
import os
import sys
import threading
import time

# 协议通道：只用来输出给 Node 的 JSON。飞书 SDK 自己的打印会被赶到 stderr，
# 免得混进来把协议搞乱；同时强制 UTF-8，保证中文不乱码。
REAL_OUT = sys.stdout
try:
    REAL_OUT.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(obj):
    REAL_OUT.write(json.dumps(obj, ensure_ascii=False) + "\n")
    REAL_OUT.flush()


def silence_stdout():
    """让所有 print / 日志都走 stderr，保住 stdout 上的协议"""
    sys.stdout = sys.stderr


def watch_parent(parent_pid):
    """父进程（Node 服务）没了就自己退出。
    否则电脑重启服务后，旧的长连接还挂在飞书上，消息可能被旧连接抢走。"""
    SYNCHRONIZE = 0x00100000
    WAIT_OBJECT_0 = 0x0
    while True:
        time.sleep(8)
        try:
            handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid)
            if not handle:
                os._exit(0)
            rc = ctypes.windll.kernel32.WaitForSingleObject(handle, 0)
            ctypes.windll.kernel32.CloseHandle(handle)
            if rc == WAIT_OBJECT_0:
                os._exit(0)
        except Exception:
            pass


def find_image_keys(node, out):
    """在富文本消息里递归找出所有图片 key"""
    if isinstance(node, dict):
        if node.get("tag") == "img" and node.get("image_key"):
            out.append(node["image_key"])
        for v in node.values():
            find_image_keys(v, out)
    elif isinstance(node, list):
        for v in node:
            find_image_keys(v, out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--parent-pid", type=int, default=0)
    args = parser.parse_args()

    if args.parent_pid and sys.platform == "win32":
        threading.Thread(target=watch_parent, args=(args.parent_pid,), daemon=True).start()

    try:
        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as exc:
        emit({"status": "error", "error": "读不到配置文件: %s" % exc})
        return 2

    app_id = (cfg.get("appId") or "").strip()
    app_secret = (cfg.get("appSecret") or "").strip()
    out_dir = cfg.get("outDir") or ""
    if not app_id or not app_secret:
        emit({"status": "error", "error": "还没填 App ID / App Secret"})
        return 2
    if not out_dir:
        emit({"status": "error", "error": "没配置收件箱目录"})
        return 2

    os.makedirs(out_dir, exist_ok=True)

    try:
        import lark_oapi as lark
        from lark_oapi.api.im.v1 import GetMessageResourceRequest, ListMessageRequest
    except Exception as exc:
        emit({"status": "error", "error": "飞书 SDK 没装好: %s" % exc})
        return 2

    # 飞书 SDK 默认把日志打到 stdout，会污染给 Node 的协议通道；
    # 更重要的是：它连接成功/失败/断线重连都只写日志、不回调，
    # 所以只能靠拦它的日志来判断真实连接状态，否则界面会显示假的"已连上"。
    import logging

    class StatusHandler(logging.Handler):
        def emit(self, record):
            try:
                msg = record.getMessage()
            except Exception:
                return
            # 注意：'"disconnected to"' 里也含 '"connected to"'，必须先判断断线
            if "disconnected to" in msg:
                emit({"status": "reconnecting"})
            elif "connected to" in msg:
                emit({"status": "ready"})
            elif "connect failed" in msg or "receive message loop exit" in msg:
                reason = msg.split("err:")[-1].strip() if "err:" in msg else msg
                emit({"status": "error", "error": reason[:200]})
            elif "trying to reconnect" in msg:
                emit({"status": "reconnecting"})

    lark_logger = logging.getLogger("Lark")
    lark_logger.handlers = [StatusHandler(), logging.StreamHandler(sys.stderr)]
    lark_logger.setLevel(logging.INFO)

    client = lark.Client.builder().app_id(app_id).app_secret(app_secret).build()

    # ---- 记住处理过哪些消息、在哪些会话里，用来补收"电脑关机期间"发的截图 ----
    state_path = cfg.get("stateFile") or os.path.join(os.path.dirname(args.config), "feishu-state.json")
    state_lock = threading.Lock()

    def load_state():
        try:
            with open(state_path, encoding="utf-8") as f:
                s = json.load(f)
                return {
                    "chats": list(s.get("chats") or []),
                    "processed": list(s.get("processed") or []),
                }
        except Exception:
            return {"chats": [], "processed": []}

    def save_state(s):
        with state_lock:
            s["processed"] = s["processed"][-800:]  # 别无限涨
            try:
                tmp = state_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(s, f, ensure_ascii=False)
                os.replace(tmp, state_path)
            except Exception:
                pass

    state = load_state()

    def remember(chat_id, message_id):
        if chat_id and chat_id not in state["chats"]:
            state["chats"].append(chat_id)
        if message_id and message_id not in state["processed"]:
            state["processed"].append(message_id)
        save_state(state)

    def save_image(message_id, file_key):
        name = "fs_%s_%s.png" % (time.strftime("%Y%m%d-%H%M%S"), message_id[-6:])
        path = os.path.join(out_dir, name)
        try:
            req = (
                GetMessageResourceRequest.builder()
                .message_id(message_id)
                .file_key(file_key)
                .type("image")
                .build()
            )
            resp = client.im.v1.message_resource.get(req)
            if resp.code != 0 or resp.file is None:
                emit({"status": "error", "error": "下载图片失败：%s" % getattr(resp, "msg", resp.code)})
                return
            data = resp.file.read()
            if not data:
                emit({"status": "error", "error": "下载到的图片是空的"})
                return
            with open(path, "wb") as f:
                f.write(data)
            emit({"status": "saved", "file": name, "size": len(data)})
        except Exception as exc:
            emit({"status": "error", "error": "保存图片出错: %s" % exc})

    def on_message(data):
        """收到消息：是图片就下载，别的类型忽略"""
        try:
            message = data.event.message
            remember(getattr(message, "chat_id", ""), message.message_id)
            mtype = message.message_type
            content = json.loads(message.content or "{}")
            if mtype == "image":
                key = content.get("image_key")
                if key:
                    save_image(message.message_id, key)
            elif mtype == "post":
                keys = []
                find_image_keys(content, keys)
                for key in keys:
                    save_image(message.message_id, key)
            return None
        except Exception as exc:
            emit({"status": "error", "error": "处理消息出错: %s" % exc})
            return None

    def backfill():
        """补收：电脑关机期间发的截图，飞书不会重推，但会话历史里还在。
        直接拉最近的会话消息，靠「这条消息处理过没有」来判断新的，
        避开 start_time 到底是秒还是毫秒这个坑。"""
        if not state["chats"]:
            emit({"status": "nochat"})
            return
        total = 0
        for chat_id in list(state["chats"]):
            try:
                page_token = None
                fetched = 0
                while fetched < 300:
                    builder = (
                        ListMessageRequest.builder()
                        .container_id_type("chat")
                        .container_id(chat_id)
                        .sort_type("ByCreateTimeDesc")
                        .page_size(50)
                    )
                    if page_token:
                        builder = builder.page_token(page_token)
                    resp = client.im.v1.message.list(builder.build())
                    if resp.code != 0:
                        emit({"status": "error", "error": "读会话历史失败：%s" % getattr(resp, "msg", resp.code)})
                        break
                    if not resp.data or not resp.data.items:
                        break
                    fresh = 0
                    for m in resp.data.items:
                        fetched += 1
                        if m.message_id in state["processed"]:
                            continue
                        fresh += 1
                        sender_type = getattr(getattr(m, "sender", None), "sender_type", "")
                        if sender_type != "user":
                            remember(chat_id, m.message_id)
                            continue
                        try:
                            body = json.loads(getattr(m.body, "content", "") or "{}")
                        except Exception:
                            body = {}
                        if m.msg_type == "image" and body.get("image_key"):
                            save_image(m.message_id, body["image_key"])
                            total += 1
                        elif m.msg_type == "post":
                            keys = []
                            find_image_keys(body, keys)
                            for key in keys:
                                save_image(m.message_id, key)
                                total += 1
                        remember(chat_id, m.message_id)
                    page_token = getattr(resp.data, "page_token", None)
                    # 这一页全是老的，说明前面也没有新的了
                    if fresh == 0 or not page_token:
                        break
            except Exception as exc:
                emit({"status": "error", "error": "补收历史消息失败: %s" % exc})
        emit({"status": "backfill", "count": total})

    handler = (
        lark.EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(on_message)
        .build()
    )

    ws_client = lark.ws.Client(
        app_id,
        app_secret,
        event_handler=handler,
        log_level=lark.LogLevel.INFO,
        auto_reconnect=True,
    )

    silence_stdout()
    emit({"status": "connecting"})

    # 连上之后，后台补一次历史（电脑关机期间发的截图就在这里找回来）
    def start_backfill():
        time.sleep(3)
        backfill()

    threading.Thread(target=start_backfill, daemon=True).start()

    try:
        ws_client.start()
    except KeyboardInterrupt:
        emit({"status": "stopped"})
        return 0
    except Exception as exc:
        emit({"status": "error", "error": "连接飞书失败: %s" % exc})
        return 1
    emit({"status": "stopped"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
