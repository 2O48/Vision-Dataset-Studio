"""HTTP 端点集成测试。

用 ThreadingHTTPServer 启动真实服务实例，通过 http.client 打端点，
覆盖核心流程：静态资源、工作区打开/重扫、条目列表/详情/保存、AI 状态、
Prompt 模板、错误处理。这是后续重构的回归安全网。
"""

from __future__ import annotations

import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from PIL import Image

from core.dataset_paths import ensure_dataset_dirs
from server.web_server import AppHandler


class WebServerRoutesTests(unittest.TestCase):
    """通过真实 HTTP 调用验证端点行为。"""

    server: ThreadingHTTPServer
    port: int

    @classmethod
    def setUpClass(cls) -> None:
        ensure_dataset_dirs()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
        cls.port = cls.server.server_address[1]
        cls._thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    # ---------- 辅助方法 ----------
    def _get(self, path: str) -> tuple[int, bytes]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request("GET", path)
            resp = conn.getresponse()
            body = resp.read()
            return resp.status, body
        finally:
            conn.close()

    def _get_json(self, path: str) -> tuple[int, dict]:
        status, body = self._get(path)
        return status, json.loads(body.decode("utf-8"))

    def _post_json(self, path: str, payload: dict) -> tuple[int, dict]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            conn.request("POST", path, body=data, headers={"Content-Type": "application/json"})
            resp = conn.getresponse()
            body = resp.read()
            return resp.status, json.loads(body.decode("utf-8"))
        finally:
            conn.close()

    @staticmethod
    def _make_dataset(tmpdir: str, count: int = 2) -> str:
        """在临时目录下创建 count 个 result 条目（图片 + caption）。"""
        result_dir = Path(tmpdir) / "result"
        result_dir.mkdir(parents=True)
        for i in range(count):
            Image.new("RGB", (32, 32), (10 * i, 20, 30)).save(result_dir / f"item_{i}.png")
            (result_dir / f"item_{i}.txt").write_text(f"caption {i}", encoding="utf-8")
        return str(result_dir)

    def _open_workspace(self, result_dir: str, control_count: int = 0) -> dict:
        status, data = self._post_json(
            "/api/workspace/open",
            {"result_dir": result_dir, "control_count": control_count},
        )
        self.assertEqual(status, 200, f"workspace open failed: {data}")
        self.assertTrue(data["ok"])
        return data["workspace"]

    # ---------- 静态资源 ----------
    def test_home_page_returns_html(self) -> None:
        status, body = self._get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<html", body.lower())

    def test_app_js_served(self) -> None:
        status, body = self._get("/app.js")
        self.assertEqual(status, 200)
        self.assertGreater(len(body), 0)

    def test_styles_css_served(self) -> None:
        status, _ = self._get("/styles.css")
        self.assertEqual(status, 200)

    # ---------- 无依赖 GET 端点 ----------
    def test_ai_status_returns_all_service_snapshots(self) -> None:
        status, data = self._get_json("/api/ai/status")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        for key in ("service", "api_service", "ollama_service", "batch", "image_process", "export"):
            self.assertIn(key, data, f"ai/status 缺少 {key}")

    def test_prompt_templates_returns_list(self) -> None:
        status, data = self._get_json("/api/prompt-templates")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertIsInstance(data["templates"], list)

    def test_ai_options_returns_defaults(self) -> None:
        status, data = self._get_json("/api/ai/options")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["default_local_model"], "qwen3.5-4b")
        self.assertIn("default_ollama_url", data)

    def test_workspace_summary_when_empty(self) -> None:
        status, data = self._get_json("/api/workspace")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertIn("workspace", data)

    def test_export_status(self) -> None:
        status, data = self._get_json("/api/export/status")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertIn("export", data)

    def test_image_process_status(self) -> None:
        status, data = self._get_json("/api/images/process/status")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertIn("image_process", data)

    # ---------- 错误处理 ----------
    def test_unknown_route_returns_404(self) -> None:
        status, data = self._get_json("/api/nonexistent-endpoint")
        self.assertEqual(status, 404)
        self.assertFalse(data["ok"])
        self.assertIn("error", data)

    def test_item_get_missing_name_returns_400(self) -> None:
        status, data = self._get_json("/api/item")
        self.assertEqual(status, 400)
        self.assertFalse(data["ok"])

    def test_item_get_nonexistent_returns_404(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._open_workspace(self._make_dataset(tmp, count=1))
            status, data = self._get_json("/api/item?name=does_not_exist")
            self.assertEqual(status, 404)

    # ---------- 工作区核心流程 ----------
    def test_workspace_open_returns_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result_dir = self._make_dataset(tmp, count=3)
            workspace = self._open_workspace(result_dir, control_count=0)
            self.assertEqual(workspace["settings"]["control_count"], 0)

    def test_items_list_after_open(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._open_workspace(self._make_dataset(tmp, count=3))
            status, data = self._get_json("/api/items")
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
            self.assertEqual(len(data["items"]), 3)

    def test_items_filter_missing_txt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result_dir = Path(tmp) / "result"
            result_dir.mkdir(parents=True)
            # 一个有 txt，一个没有
            Image.new("RGB", (32, 32)).save(result_dir / "with_txt.png")
            (result_dir / "with_txt.txt").write_text("cap", encoding="utf-8")
            Image.new("RGB", (32, 32)).save(result_dir / "no_txt.png")
            self._open_workspace(str(result_dir))
            status, data = self._get_json("/api/items?filter=no_txt")
            self.assertEqual(status, 200)
            names = [item["name"] for item in data["items"]]
            self.assertIn("no_txt", names)
            self.assertNotIn("with_txt", names)

    def test_item_get_returns_detail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._open_workspace(self._make_dataset(tmp, count=1))
            status, data = self._get_json("/api/item?name=item_0")
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
            self.assertIn("item", data)

    def test_item_save_text_persists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._open_workspace(self._make_dataset(tmp, count=1))
            status, data = self._post_json("/api/item/save", {"name": "item_0", "text": "new caption"})
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
            # 重新获取确认持久化
            _, refetched = self._get_json("/api/item?name=item_0")
            self.assertEqual(refetched["item"]["text"], "new caption")

    def test_workspace_rescan_preserves_items(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._open_workspace(self._make_dataset(tmp, count=2))
            status, data = self._post_json("/api/workspace/rescan", {})
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
            self.assertIn("workspace", data)

    def test_workspace_merge_appends_items(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._open_workspace(self._make_dataset(tmp, count=2))
            # 创建第二个数据集追加
            extra_dir = Path(tmp) / "extra" / "result"
            extra_dir.mkdir(parents=True)
            Image.new("RGB", (32, 32)).save(extra_dir / "extra_item.png")
            (extra_dir / "extra_item.txt").write_text("extra", encoding="utf-8")
            status, data = self._post_json(
                "/api/workspace/merge",
                {"result_dir": str(extra_dir), "control_count": 0},
            )
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
            self.assertGreaterEqual(data.get("merged", 0), 1)


if __name__ == "__main__":
    unittest.main()
