"""
微信读书书摘导入模块
支持从微信读书导出的笔记/划线文本中提取书摘并入库
"""
import re
import json
from typing import Optional
from sqlalchemy.orm import Session
from database import SessionLocal, Quote, Book


def parse_wechat_read_export(text: str) -> list[dict]:
    """
    解析微信读书导出的笔记文本

    微信读书导出格式示例：
    《书名》
    作者：xxx

    ◆ 你的划线
    >> 划线内容1

    ◆ 你的想法
    >> 想法内容1

    返回: [{quote_text, book_title, author, note, chapter}]
    """
    quotes = []
    lines = text.strip().split("\n")

    current_book = ""
    current_author = ""
    current_type = ""  # "划线" or "想法"
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        # 书名
        if line.startswith("《") and line.endswith("》"):
            current_book = line[1:-1]
            i += 1
            continue

        # 作者
        if line.startswith("作者：") or line.startswith("作者:"):
            current_author = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            i += 1
            continue

        # 类型标记
        if "你的划线" in line:
            current_type = "划线"
            i += 1
            continue
        if "你的想法" in line:
            current_type = "想法"
            i += 1
            continue

        # 划线/想法内容
        if line.startswith(">>") and current_book:
            content = line[2:].strip()
            if content:
                quotes.append(
                    {
                        "quote_text": content,
                        "book_title": current_book,
                        "author": current_author,
                        "note": "" if current_type == "划线" else content,
                        "chapter": "",
                    }
                )
            i += 1
            continue

        i += 1

    return quotes


def import_quotes_to_db(quotes: list[dict], user_id: str) -> dict:
    """将解析后的书摘批量导入数据库"""
    db: Session = SessionLocal()
    imported = 0
    skipped = 0

    try:
        for q in quotes:
            # 检查是否已存在（按内容去重）
            existing = (
                db.query(Quote)
                .filter(Quote.quote_text == q["quote_text"], Quote.user_id == user_id)
                .first()
            )
            if existing:
                skipped += 1
                continue

            # 查找或创建书籍
            book = (
                db.query(Book)
                .filter(Book.title == q["book_title"])
                .first()
            )
            if not book:
                book = Book(
                    title=q["book_title"],
                    author=q["author"],
                    category="",
                )
                db.add(book)
                db.flush()

            # 创建书摘
            quote = Quote(
                user_id=user_id,
                quote_text=q["quote_text"],
                book_id=book.id,
                note=q.get("note", ""),
                source="微信读书导入",
            )
            db.add(quote)
            imported += 1

        db.commit()
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()

    return {"imported": imported, "skipped": skipped}


def export_wechat_read_guide() -> str:
    """
    微信读书导出操作指南
    微信读书没有公开 API，目前只能通过以下方式获取数据：
    """
    return """
═══ 微信读书书摘导出指南 ═══

方式一：微信读书 App 内导出（推荐）
1. 打开微信读书 App → 我 → 笔记
2. 选择一本书 → 点右上角「...」→ 「导出笔记」
3. 选择「复制到剪贴板」或「发送到电脑」
4. 将导出的文本粘贴到下方导入

方式二：手动整理
1. 在微信读书中浏览你的划线
2. 将喜欢的句子整理成以下格式：
   《书名》
   作者：xxx
   >> 划线内容
   （可以备注自己的想法）

方式三：浏览器插件（高级）
1. 使用 Chrome 插件 "Wereader" 或 "微信读书助手"
2. 可批量导出所有笔记为 JSON/CSV
3. 将 JSON 文件发送到 POST /api/quotes/import-json

═══ 导入后 ═══
- 书摘自动存入数据库，生成向量索引
- 在阅读页的「书架」中可以看到
- Agent 对话时会自动检索相关书摘引用
"""
