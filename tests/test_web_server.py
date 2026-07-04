import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from server.caption_workflow import (
    VALIDATION_EXISTING_CAPTION,
    apply_caption_result,
    build_modify_prompt,
    normalize_overwrite_mode,
    resolve_caption_request,
)
from server.web_server import _render_thumbnail_bytes


class WebServerCaptionModeTests(unittest.TestCase):
    def test_normalize_overwrite_mode_accepts_modify(self):
        self.assertEqual(normalize_overwrite_mode("modify"), "modify")
        self.assertEqual(normalize_overwrite_mode("unknown"), "overwrite")

    def test_apply_caption_result_append_preserves_existing(self):
        merged = apply_caption_result("soft light", "blue dress", "append")
        self.assertEqual(merged, "soft light, blue dress")

    def test_apply_caption_result_overwrite_returns_result(self):
        self.assertEqual(apply_caption_result("old text", "new text", "overwrite"), "new text")
        self.assertEqual(apply_caption_result("old text", "new text", "modify"), "new text")

    def test_build_modify_prompt_embeds_existing_and_instruction(self):
        prompt = build_modify_prompt("old caption", "make it shorter")
        self.assertIn("Existing caption:\nold caption", prompt)
        self.assertIn("Edit instruction:\nmake it shorter", prompt)
        self.assertIn("Return only the revised final caption.", prompt)

    def test_resolve_caption_request_uses_modify_when_existing_text_present(self):
        request = resolve_caption_request("old caption", "make it shorter", overwrite_mode="modify")
        self.assertEqual(request["write_mode"], "overwrite")
        self.assertTrue(request["used_modify"])
        self.assertFalse(request["fallback_to_overwrite"])
        self.assertIn("old caption", request["prompt"])

    def test_resolve_caption_request_falls_back_when_existing_text_missing(self):
        request = resolve_caption_request("", "describe image", overwrite_mode="modify")
        self.assertEqual(request["write_mode"], "overwrite")
        self.assertFalse(request["used_modify"])
        self.assertTrue(request["fallback_to_overwrite"])
        self.assertEqual(request["prompt"], "describe image")

    def test_validation_seed_is_non_empty_for_modify_validation(self):
        self.assertTrue(VALIDATION_EXISTING_CAPTION.strip())


class WebServerThumbnailTests(unittest.TestCase):
    def test_render_thumbnail_preserves_alpha_for_png(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "transparent.png"
            image = Image.new("RGBA", (64, 64), (255, 0, 0, 0))
            for x in range(16, 48):
                for y in range(16, 48):
                    image.putpixel((x, y), (0, 128, 255, 160))
            image.save(source)

            data = _render_thumbnail_bytes(source, 32, 32)

            self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
            with Image.open(Path(tmpdir) / "transparent.png") as original:
                self.assertEqual(original.mode, "RGBA")
            with Image.open(Path(tmpdir) / "transparent.png") as original:
                self.assertEqual(original.getbands(), ("R", "G", "B", "A"))
            with Image.open(source) as original:
                self.assertEqual(original.mode, "RGBA")
            with Image.open(Path(tmpdir) / "transparent.png") as original:
                self.assertEqual(original.size, (64, 64))
            with Image.open(source) as original:
                self.assertEqual(original.size, (64, 64))
            with Image.open(source) as original:
                self.assertEqual(original.getpixel((0, 0))[3], 0)
            with Image.open(source) as original:
                self.assertEqual(original.getpixel((24, 24))[3], 160)
            with Image.open(Path(tmpdir) / "transparent.png") as original:
                self.assertEqual(original.getpixel((24, 24))[3], 160)

            with Image.open(io.BytesIO(data)) as thumb:
                self.assertEqual(thumb.mode, "RGBA")
                self.assertEqual(thumb.size, (32, 32))
                self.assertEqual(thumb.getpixel((0, 0))[3], 0)
                self.assertGreater(thumb.getpixel((24, 24))[3], 0)


if __name__ == "__main__":
    unittest.main()
