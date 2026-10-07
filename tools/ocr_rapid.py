# -*- coding: utf-8 -*-
"""
Arwoo 财务助手 —— 截图文字识别（RapidOCR，离线运行，不联网、不上传）

两种用法：
  单张:  python ocr_rapid.py --image shot.png --out result.json
  常驻:  python ocr_rapid.py --serve
         从 stdin 逐行读 {"image":"...","out":"..."}，识别结果写进 out 文件，
         然后往 stdout 回一行 {"done":true} / {"done":false,"error":"..."}。

输出给网页的格式（两种模式一致）：
  { "ok": true, "engine": "rapidocr", "words": [ {"t":"文本","x":..,"y":..,"w":..,"h":..,"score":..} ] }
- 每个识别框当做一个“词”，带上左上角坐标和宽高，
  网页那边再按纵向位置把它们归并成“行”，顺便还能用字号大小挑金额。
"""

import argparse
import json
import os
import sys


def build_result(items):
    words = []
    for item in items or []:
        try:
            box, text, score = item[0], item[1], item[2]
        except Exception:
            continue
        if not text:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        words.append({
            "t": str(text),
            "x": round(min(xs), 1),
            "y": round(min(ys), 1),
            "w": round(max(xs) - min(xs), 1),
            "h": round(max(ys) - min(ys), 1),
            "score": round(float(score), 4),
        })
    return {"ok": True, "engine": "rapidocr", "words": words}


def make_engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR()


def recognize(engine, image_path):
    result, _elapse = engine(image_path)
    return build_result(result)


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def run_serve():
    """常驻模式：模型只加载一次，之后每张图都很快。"""
    real_out = sys.stdout
    err_out = sys.stderr
    try:
        sys.stdout = err_out  # 载入模型时库里的打印别污染协议
        engine = make_engine()
    except Exception as exc:
        sys.stdout = real_out
        real_out.write(json.dumps({"done": False, "error": "引擎初始化失败: %s" % exc}, ensure_ascii=False) + "\n")
        real_out.flush()
        return 1

    sys.stdout = real_out
    real_out.write(json.dumps({"ready": True, "engine": "rapidocr"}, ensure_ascii=False) + "\n")
    real_out.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line in ("exit", "quit"):
            break
        try:
            req = json.loads(line)
        except Exception:
            real_out.write(json.dumps({"done": False, "error": "请求格式不对"}, ensure_ascii=False) + "\n")
            real_out.flush()
            continue
        out_path = req.get("out")
        try:
            sys.stdout = err_out
            res = recognize(engine, req.get("image"))
            sys.stdout = real_out
            write_json(out_path, res)
            real_out.write(json.dumps({"done": True, "count": len(res["words"])}, ensure_ascii=False) + "\n")
        except Exception as exc:
            sys.stdout = real_out
            try:
                write_json(out_path, {"ok": False, "error": str(exc)})
            except Exception:
                pass
            real_out.write(json.dumps({"done": False, "error": str(exc)}, ensure_ascii=False) + "\n")
        real_out.flush()
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--image")
    parser.add_argument("--out")
    parser.add_argument("--warmup", action="store_true", help="只加载模型后退出，用来预热")
    args = parser.parse_args()

    if args.serve:
        sys.exit(run_serve())

    if args.warmup:
        try:
            make_engine()
            print(json.dumps({"ok": True, "engine": "rapidocr"}))
            sys.exit(0)
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            sys.exit(1)

    if not args.image or not args.out:
        print("need --image and --out", file=sys.stderr)
        sys.exit(2)

    try:
        write_json(args.out, recognize(make_engine(), args.image))
        sys.exit(0)
    except Exception as exc:
        write_json(args.out, {"ok": False, "error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
