"""数据集导出器测试。

覆盖纯函数（文件名清理、目标尺寸计算、缩放裁切）和 export_dataset 集成流程
（folder/zip 格式、图像处理开关、控制图包含、manifest 生成）。
"""

from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from core.dataset_exporter import (
    clean_name,
    export_dataset,
    resize_center_crop,
    target_size_for,
    unique_export_name,
    unique_name,
)


class ExporterPureFunctionTests(unittest.TestCase):
    def testclean_name_strips_illegal_chars(self) -> None:
        self.assertEqual(clean_name("a/b:c*d"), "a_b_c_d")

    def testclean_name_uses_fallback_for_empty(self) -> None:
        self.assertEqual(clean_name("", "fallback"), "fallback")
        self.assertEqual(clean_name("   ", "fallback"), "fallback")

    def testclean_name_collapses_whitespace(self) -> None:
        self.assertEqual(clean_name("a   b"), "a b")

    def testunique_name_first_use(self) -> None:
        used: set[str] = set()
        self.assertEqual(unique_name("item", used), "item")
        self.assertIn("item", used)

    def testunique_name_appends_index_on_conflict(self) -> None:
        used = {"item"}
        self.assertEqual(unique_name("item", used), "item_2")
        self.assertEqual(unique_name("item", used), "item_3")

    def testunique_export_name_without_subfolders(self) -> None:
        used: set[str] = set()
        self.assertEqual(unique_export_name("sample", used, preserve_subfolders=False), "sample")
        self.assertEqual(unique_export_name("sample", used, preserve_subfolders=False), "sample_2")

    def testunique_export_name_preserves_subfolders(self) -> None:
        used: set[str] = set()
        name = unique_export_name("group/item", used, preserve_subfolders=True)
        self.assertEqual(name, "group/item")
        name2 = unique_export_name("group/item", used, preserve_subfolders=True)
        self.assertEqual(name2, "group/item_2")

    def testtarget_size_for_respects_multiple(self) -> None:
        width, height = target_size_for((2000, 1000), 4_000_000, 64)
        self.assertEqual(width % 64, 0)
        self.assertEqual(height % 64, 0)
        self.assertLessEqual(width * height, 4_000_000)

    def testtarget_size_for_clamps_to_minimum_multiple(self) -> None:
        width, height = target_size_for((10, 10), 1_000_000, 16)
        self.assertGreaterEqual(width, 16)
        self.assertGreaterEqual(height, 16)

    def testtarget_size_for_invalid_size_raises(self) -> None:
        with self.assertRaises(ValueError):
            target_size_for((0, 100), 1_000_000, 16)

    def testresize_center_crop_returns_target_size(self) -> None:
        source = Image.new("RGB", (800, 400), (10, 20, 30))
        result = resize_center_crop(source, (512, 512))
        self.assertEqual(result.size, (512, 512))

    def testresize_center_crop_handles_grayscale(self) -> None:
        source = Image.new("L", (200, 200), 128)
        result = resize_center_crop(source, (64, 64))
        self.assertEqual(result.mode, "RGB")
        self.assertEqual(result.size, (64, 64))


class ExportDatasetIntegrationTests(unittest.TestCase):
    """端到端验证 export_dataset 的文件输出与 manifest。"""

    @staticmethod
    def _make_dataset(tmpdir: Path, count: int = 2, with_control: bool = True) -> list[dict]:
        result_dir = tmpdir / "result"
        result_dir.mkdir(parents=True)
        control_dir = tmpdir / "control1"
        if with_control:
            control_dir.mkdir(parents=True)
        items: list[dict] = []
        for i in range(count):
            Image.new("RGB", (256, 256), (i * 10, 20, 30)).save(result_dir / f"item_{i}.png")
            (result_dir / f"item_{i}.txt").write_text(f"caption {i}", encoding="utf-8")
            paths: dict = {"result": str(result_dir / f"item_{i}.png")}
            if with_control:
                Image.new("RGB", (256, 256), (40, 50, 60)).save(control_dir / f"item_{i}.png")
                paths["control1"] = str(control_dir / f"item_{i}.png")
            items.append({"name": f"item_{i}", "paths": paths, "text": f"caption {i}"})
        return items

    def test_export_folder_writes_result_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            items = self._make_dataset(tmp_path, count=2)
            output_dir = tmp_path / "output"

            result = export_dataset(
                items=items,
                output_format="folder",
                output_dir=str(output_dir),
                project_name="测试项目",
                target_megapixels=1.0,
                multiple=16,
                process_images=True,
                include_controls=False,
                control_count=0,
            )

            self.assertIn("path", result)
            export_root = Path(result["path"])
            self.assertTrue(export_root.is_dir())
            # 结果图目录应含 2 张处理后的图
            result_folders = list(export_root.glob("*_result"))
            self.assertEqual(len(result_folders), 1)
            exported_images = list(result_folders[0].glob("*.png"))
            self.assertEqual(len(exported_images), 2)
            # manifest.json 应存在且含条目记录
            manifest_file = export_root / "manifest.json"
            self.assertTrue(manifest_file.exists())
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            self.assertIn("items", manifest)

    def test_export_includes_control_folders(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            items = self._make_dataset(tmp_path, count=1, with_control=True)
            output_dir = tmp_path / "output"

            result = export_dataset(
                items=items,
                output_format="folder",
                output_dir=str(output_dir),
                project_name="with_control",
                target_megapixels=1.0,
                multiple=16,
                process_images=True,
                include_controls=True,
                control_count=1,
            )

            export_root = Path(result["path"])
            self.assertTrue(any(export_root.glob("*_control1")))
            self.assertTrue(any(export_root.glob("*_result")))

    def test_export_zip_produces_valid_archive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            items = self._make_dataset(tmp_path, count=2, with_control=False)
            output_dir = tmp_path / "output"

            result = export_dataset(
                items=items,
                output_format="zip",
                output_dir=str(output_dir),
                project_name="zip_project",
                target_megapixels=1.0,
                multiple=32,
                process_images=True,
                include_controls=False,
                control_count=0,
            )

            zip_path = Path(result["path"])
            self.assertTrue(zip_path.is_file())
            self.assertEqual(zip_path.suffix, ".zip")
            with zipfile.ZipFile(zip_path) as zf:
                names = zf.namelist()
                self.assertTrue(any("manifest.json" in n for n in names))
                result_pngs = [n for n in names if n.endswith(".png")]
                self.assertEqual(len(result_pngs), 2)

    def test_export_without_image_processing_keeps_original_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            items = self._make_dataset(tmp_path, count=1, with_control=False)
            output_dir = tmp_path / "output"

            result = export_dataset(
                items=items,
                output_format="folder",
                output_dir=str(output_dir),
                project_name="no_process",
                target_megapixels=1.0,
                multiple=16,
                process_images=False,
                include_controls=False,
                control_count=0,
            )

            export_root = Path(result["path"])
            result_folder = next(export_root.glob("*_result"))
            exported = list(result_folder.glob("*.png"))[0]
            with Image.open(exported) as img:
                self.assertEqual(img.size, (256, 256))

    def test_export_invalid_multiple_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            items = self._make_dataset(Path(tmp), count=1, with_control=False)
            with self.assertRaises(ValueError):
                export_dataset(
                    items=items,
                    output_format="folder",
                    output_dir=str(Path(tmp) / "out"),
                    project_name="bad",
                    multiple=48,  # 非法值
                    control_count=0,
                )

    def test_export_skips_items_without_result_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            items = self._make_dataset(tmp_path, count=1, with_control=False)
            # 加入一个 result 路径不存在的条目
            items.append({"name": "ghost", "paths": {"result": str(tmp_path / "nope.png")}, "text": ""})

            result = export_dataset(
                items=items,
                output_format="folder",
                output_dir=str(tmp_path / "output"),
                project_name="skip_test",
                target_megapixels=1.0,
                multiple=16,
                include_controls=False,
                control_count=0,
            )

            self.assertGreaterEqual(len(result.get("skipped", [])), 1)


if __name__ == "__main__":
    unittest.main()
