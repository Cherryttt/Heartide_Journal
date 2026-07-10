"""微信读书官方 Agent API Gateway 客户端。"""
import os
import httpx
from typing import Optional
from config import settings


class WeReadClient:
    """微信读书 API 客户端"""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.weread_api_key or os.getenv("WEREAD_API_KEY", "")
        self.base_url = settings.weread_api_base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _request(self, api_name: str, params: dict = None) -> dict:
        if not self.api_key:
            raise RuntimeError("请设置 WEREAD_API_KEY 环境变量")
        if not self.base_url:
            raise RuntimeError("请设置 WEREAD_API_BASE_URL")
        payload = {
            "api_name": api_name,
            "skill_version": settings.weread_skill_version,
            **(params or {}),
        }
        with httpx.Client(timeout=30) as client:
            resp = client.post(self.base_url, headers=self.headers, json=payload)
            resp.raise_for_status()
            result = resp.json()
        if result.get("upgrade_info"):
            raise RuntimeError(result["upgrade_info"].get("message", "微信读书 Skill 需要升级"))
        if result.get("errcode") not in (None, 0):
            raise RuntimeError(result.get("errmsg") or result.get("message") or f"微信读书接口错误: {result['errcode']}")
        return result

    def _get(self, path: str, params: dict = None) -> dict:
        return self._request(path, params)

    def _post(self, path: str, data: dict = None) -> dict:
        return self._request(path, data)

    # ============================================================
    # 书架
    # ============================================================
    def get_shelf(self) -> dict:
        """获取书架"""
        return self._get("/shelf/sync")

    def get_book_info(self, book_id: str) -> dict:
        """书籍基本信息"""
        return self._get("/book/info", {"bookId": book_id})

    def get_chapter_info(self, book_id: str) -> dict:
        """章节目录"""
        return self._get("/book/chapterinfo", {"bookId": book_id})

    def get_progress(self, book_id: str) -> dict:
        """阅读进度"""
        return self._get("/book/getprogress", {"bookId": book_id})

    # ============================================================
    # 笔记/划线
    # ============================================================
    def get_notebooks(self) -> dict:
        """笔记本概览（划线/想法/书签数量）"""
        return self._get("/user/notebooks")

    def get_bookmarks(self, book_id: str) -> dict:
        """单本书划线内容"""
        return self._get("/book/bookmarklist", {"bookId": book_id})

    def get_my_reviews(self) -> dict:
        """我的想法与点评"""
        return self._post("/review/list/mine", {})

    def get_hot_bookmarks(self, book_id: str) -> dict:
        """热门划线"""
        return self._get("/book/bestbookmarks", {"bookId": book_id})

    # ============================================================
    # 阅读统计
    # ============================================================
    def get_read_data(self, mode: str = "monthly") -> dict:
        """阅读统计

        mode: weekly | monthly | annually | overall
        """
        return self._get("/readdata/detail", {"mode": mode})

    # ============================================================
    # 搜索
    # ============================================================
    def search(
        self,
        keyword: str,
        scope: int = 0,
        max_idx: int = 0,
        count: int = 20,
    ) -> dict:
        """书城搜索

        scope: 0=全部, 10=电子书, 16=网文小说, 14=微信听书,
               6=作者, 12=全文, 13=书单, 2=公众号, 4=文章
        """
        return self._get("/store/search", {
            "keyword": keyword,
            "scope": scope,
            "maxIdx": max_idx,
            "count": count,
        })

    # ============================================================
    # 推荐/书评
    # ============================================================
    def get_recommendations(self) -> dict:
        """为你推荐"""
        return self._get("/book/recommend")

    def get_similar_books(self, book_id: str) -> dict:
        """相似书推荐"""
        return self._get("/book/similar", {"bookId": book_id})

    def get_reviews(self, book_id: str, list_type: int = 0) -> dict:
        """书籍点评

        list_type: 0=全部, 1=推荐, 2=不行, 3=最新, 4=一般
        """
        return self._get("/review/list", {"bookId": book_id, "reviewListType": list_type})

    # ============================================================
    # 批量导出书摘（与 MoodGarden 集成）
    # ============================================================
    def export_quotes_to_moodgarden(self) -> list[dict]:
        """导出全部划线为 MoodGarden 格式"""
        quotes = []
        # 获取书架
        shelf = self.get_shelf()
        books = shelf.get("books", [])

        for book in books:
            book_id = book.get("bookId")
            if not book_id:
                continue
            try:
                # 获取阅读进度
                progress = self.get_progress(book_id)
                # 获取划线
                bookmarks = self.get_bookmarks(book_id)
                for mark in bookmarks.get("marks", []):
                    quotes.append({
                        "quote_text": mark.get("markText", ""),
                        "book_title": book.get("title", ""),
                        "author": book.get("author", ""),
                        "note": mark.get("note", ""),
                        "chapter": mark.get("chapterTitle", ""),
                        "created_at": mark.get("createTime", ""),
                    })
            except Exception:
                continue

        return quotes


# 全局单例（按需初始化）
wechat_read_client: Optional[WeReadClient] = None


def get_wechat_read_client() -> WeReadClient:
    """获取微信读书客户端（懒加载）"""
    global wechat_read_client
    if wechat_read_client is None:
        wechat_read_client = WeReadClient()
    return wechat_read_client
