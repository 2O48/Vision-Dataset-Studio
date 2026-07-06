import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from core.dataset_projects import ProjectStore
from core.dataset_workspace import DatasetWorkspace


class ProjectStoreTests(unittest.TestCase):
    def _make_workspace(self, root: Path) -> DatasetWorkspace:
        result_dir = root / "source" / "result"
        control_dir = root / "source" / "control1"
        (result_dir / "system").mkdir(parents=True)
        (control_dir / "system").mkdir(parents=True)
        Image.new("RGB", (32, 32), (20, 30, 40)).save(result_dir / "system" / "display_off.png")
        Image.new("RGB", (32, 32), (40, 30, 20)).save(result_dir / "system" / "display_on.png")
        Image.new("RGB", (32, 32), (60, 70, 80)).save(control_dir / "system" / "display_off.png")
        Image.new("RGB", (32, 32), (80, 70, 60)).save(control_dir / "system" / "display_on.png")

        workspace = DatasetWorkspace()
        workspace.open_dirs(
            control1_dir=str(control_dir),
            result_dir=str(result_dir),
            control_count=1,
        )
        workspace.save_text("system/display_off", "display is off")
        return workspace

    def test_save_overwrite_preserves_uncaptioned_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            workspace = self._make_workspace(root)

            saved = store.save_project(
                name="车机图标",
                workspace=workspace,
                ui_state={"caption_settings": {"backend": "ollama"}},
            )
            project_id = saved["project"]["id"]
            project_dir = Path(saved["workspace"]["dirs"]["result"]).parents[1]

            self.assertTrue((project_dir / "assets" / "result" / "system" / "display_off.png").exists())
            self.assertTrue((project_dir / "assets" / "result" / "system" / "display_on.png").exists())
            self.assertEqual(saved["project"]["item_count"], 2)
            self.assertEqual(saved["project"]["captioned_count"], 1)

            reopened = DatasetWorkspace()
            reopened.open_dirs(
                control1_dir=saved["workspace"]["dirs"]["control1"],
                result_dir=saved["workspace"]["dirs"]["result"],
                control_count=1,
            )
            reopened.save_text("system/display_off", "edited off caption")
            overwritten = store.save_project(
                name="车机图标",
                workspace=reopened,
                overwrite_id=project_id,
                ui_state={"caption_settings": {"backend": "api"}},
            )

            result_dir = Path(overwritten["workspace"]["dirs"]["result"])
            self.assertTrue((result_dir / "system" / "display_off.png").exists())
            self.assertTrue((result_dir / "system" / "display_on.png").exists())
            self.assertEqual(overwritten["project"]["id"], project_id)
            self.assertEqual(overwritten["project"]["item_count"], 2)
            self.assertEqual(overwritten["project"]["captioned_count"], 1)
            self.assertEqual(
                (result_dir / "system" / "display_off.txt").read_text(encoding="utf-8"),
                "edited off caption",
            )
            self.assertEqual(
                (result_dir.parents[1] / "state" / "caption_config.json").read_text(encoding="utf-8"),
                '{\n  "backend": "api"\n}',
            )

    def test_overwrite_save_keeps_project_directory_in_place_and_cleans_tmp_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            workspace = self._make_workspace(root)
            saved = store.save_project(name="车机图标", workspace=workspace)
            project_id = saved["project"]["id"]
            project_dir = root / "app" / "projects" / project_id
            stale_tmp = root / "app" / "projects" / f".tmp-{project_id}-stale"
            stale_tmp.mkdir()
            (stale_tmp / "old.txt").write_text("old", encoding="utf-8")

            original_replace = Path.replace

            def guarded_replace(path, target):
                if Path(path).resolve() == project_dir.resolve():
                    raise AssertionError("overwrite save should not rename the open project directory")
                return original_replace(path, target)

            reopened = DatasetWorkspace()
            reopened.open_dirs(
                control1_dir=saved["workspace"]["dirs"]["control1"],
                result_dir=saved["workspace"]["dirs"]["result"],
                control_count=1,
            )
            reopened.save_text("system/display_off", "second caption")
            reopened.delete_item("system/display_on")

            with mock.patch.object(Path, "replace", guarded_replace):
                overwritten = store.save_project(
                    name="车机图标",
                    workspace=reopened,
                    overwrite_id=project_id,
                )

            self.assertEqual(overwritten["project"]["id"], project_id)
            self.assertEqual(overwritten["project"]["item_count"], 1)
            self.assertTrue(project_dir.is_dir())
            self.assertFalse(stale_tmp.exists())
            self.assertFalse(list((root / "app" / "projects").glob(f".tmp-{project_id}-*")))
            self.assertFalse((project_dir / "assets" / "result" / "system" / "display_on.png").exists())
            self.assertEqual(
                (project_dir / "assets" / "result" / "system" / "display_off.txt").read_text(encoding="utf-8"),
                "second caption",
            )

    def test_rename_fork_and_delete_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            workspace = self._make_workspace(root)
            saved = store.save_project(name="原项目", workspace=workspace)
            project_id = saved["project"]["id"]

            renamed = store.rename_project(project_id, "新项目")
            self.assertEqual(renamed["name"], "新项目")
            self.assertNotEqual(renamed["id"], project_id)
            self.assertTrue((root / "app" / "projects" / renamed["id"]).is_dir())
            renamed_detail = store.get_project(renamed["id"])
            self.assertIn(renamed["id"], renamed_detail["workspace"]["dirs"]["result"])

            forked = store.fork_project(renamed["id"], "新项目分叉")
            self.assertEqual(forked["project"]["name"], "新项目分叉")
            self.assertNotEqual(forked["project"]["id"], renamed["id"])
            self.assertTrue((root / "app" / "projects" / forked["project"]["id"]).is_dir())
            self.assertIn(forked["project"]["id"], forked["workspace"]["dirs"]["result"])
            self.assertNotEqual(forked["workspace"]["dirs"]["result"], renamed_detail["workspace"]["dirs"]["result"])
            fork_versions = store.list_versions(forked["project"]["id"])["versions"]
            self.assertEqual(fork_versions[0]["display_message"], f"分叉自版本 {forked['source_head'][:7]}")

            deleted = store.delete_project(renamed["id"])
            self.assertEqual(deleted["deleted"], renamed["id"])
            self.assertFalse((root / "app" / "projects" / renamed["id"]).exists())
            self.assertTrue(Path(deleted["trashed_to"]).is_dir())

            cleanup = store.cleanup_trash()
            self.assertIn(Path(deleted["trashed_to"]).name, cleanup["removed"])
            self.assertFalse(Path(deleted["trashed_to"]).exists())

    def test_create_project_makes_empty_named_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")

            created = store.create_project(
                name="空白项目",
                control_count=0,
                ui_state={"utility_panel": "projects"},
            )
            project_id = created["project"]["id"]
            detail = store.get_project(project_id)
            projects = store.list_projects()

            self.assertEqual(created["project"]["name"], "空白项目")
            self.assertEqual(created["project"]["item_count"], 0)
            self.assertEqual(created["project"]["captioned_count"], 0)
            self.assertEqual(created["workspace"]["items"], [])
            self.assertEqual(created["workspace"]["settings"]["control_count"], 0)
            self.assertEqual(detail["workspace"]["ui_state"], {"utility_panel": "projects"})
            self.assertEqual(projects[0]["id"], project_id)

    def test_project_versions_rollback_and_fork(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            workspace = self._make_workspace(root)
            saved = store.save_project(name="版本项目", workspace=workspace)
            project_id = saved["project"]["id"]
            first_head = saved["version"]["hash"]

            reopened = DatasetWorkspace()
            reopened.open_dirs(
                control1_dir=saved["workspace"]["dirs"]["control1"],
                result_dir=saved["workspace"]["dirs"]["result"],
                control_count=1,
            )
            reopened.save_text("system/display_off", "second version")
            second = store.save_project(name="版本项目", workspace=reopened, overwrite_id=project_id)
            self.assertNotEqual(second["version"]["hash"], first_head)

            versions = store.list_versions(project_id)["versions"]
            self.assertGreaterEqual(len(versions), 2)
            self.assertEqual(versions[0]["hash"], second["version"]["hash"])
            self.assertEqual(versions[0]["display_message"], "添加0张图片，修改1张图片，删除0张图片")

            rolled_back = store.rollback_to_version(project_id, first_head)
            result_txt = Path(rolled_back["workspace"]["dirs"]["result"]) / "system" / "display_off.txt"
            self.assertEqual(result_txt.read_text(encoding="utf-8"), "display is off")
            self.assertNotEqual(rolled_back["head"], first_head)
            versions_after_rollback = store.list_versions(project_id)["versions"]
            hashes_after_rollback = [row["hash"] for row in versions_after_rollback]
            self.assertIn(first_head, hashes_after_rollback)
            self.assertIn(second["version"]["hash"], hashes_after_rollback)
            self.assertEqual(hashes_after_rollback[0], rolled_back["head"])
            self.assertEqual(versions_after_rollback[0]["display_message"], f"回退到版本 {first_head[:7]}")

            forked = store.fork_project_version(project_id, first_head, "旧版本分叉")
            self.assertEqual(forked["project"]["name"], "旧版本分叉")
            self.assertNotEqual(forked["project"]["id"], project_id)
            fork_txt = Path(forked["workspace"]["dirs"]["result"]) / "system" / "display_off.txt"
            self.assertEqual(fork_txt.read_text(encoding="utf-8"), "display is off")
            fork_versions = store.list_versions(forked["project"]["id"])["versions"]
            self.assertEqual(fork_versions[0]["display_message"], f"分叉自版本 {first_head[:7]}")

    def test_list_projects_repairs_stale_metadata_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            created = store.create_project(name="真实项目名")
            project_id = created["project"]["id"]
            project_dir = root / "app" / "projects" / project_id
            project_json = project_dir / "project.json"
            workspace_json = project_dir / "workspace.json"

            project_json.write_text(
                project_json.read_text(encoding="utf-8").replace(project_id, "20260603-090819-未命名项目"),
                encoding="utf-8",
            )
            workspace_json.write_text(
                workspace_json.read_text(encoding="utf-8").replace(project_id, "20260603-090819-未命名项目"),
                encoding="utf-8",
            )

            projects = store.list_projects()
            repaired = store.get_project(project_id)

            self.assertEqual(projects[0]["id"], project_id)
            self.assertEqual(repaired["project"]["id"], project_id)
            self.assertEqual(repaired["workspace"]["project_id"], project_id)

    def test_save_project_uses_selected_control_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            workspace = self._make_workspace(root)

            saved = store.save_project(name="仅结果图", workspace=workspace, control_count=0)

            self.assertEqual(saved["project"]["control_count"], 0)
            self.assertEqual(saved["workspace"]["settings"]["control_count"], 0)
            self.assertNotIn("control1", saved["workspace"]["dirs"])
            self.assertIn("result", saved["workspace"]["dirs"])

    def test_update_ui_state_preserves_common_caption_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = ProjectStore(root / "app" / "projects")
            workspace = self._make_workspace(root)
            saved = store.save_project(name="标注配置项目", workspace=workspace)
            project_id = saved["project"]["id"]
            original_updated_at = saved["project"]["updated_at"]

            ui_state = {
                "caption_settings": {
                    "local_overwrite_mode": "skip",
                    "local_caption_mode": "tag",
                    "local_max_tokens": "1024",
                    "local_thinking_mode": True,
                    "local_prompt": "只输出短标签",
                    "api_thinking_mode": True,
                    "ollama_thinking_mode": True,
                },
                "template_selections": {
                    "customPrompt": "template-tag",
                },
            }
            updated = store.update_ui_state(project_id, ui_state)
            reopened = store.get_project(project_id)

            self.assertEqual(updated["workspace"]["ui_state"], ui_state)
            self.assertEqual(reopened["workspace"]["ui_state"], ui_state)
            self.assertEqual(updated["project"]["updated_at"], original_updated_at)
            self.assertEqual(reopened["project"]["updated_at"], original_updated_at)
            with mock.patch("core.dataset_projects._now", return_value="2099-01-02T03:04:05"):
                touched = store.touch_project_content(project_id)
            self.assertEqual(touched["updated_at"], "2099-01-02T03:04:05")
            self.assertEqual(
                (root / "app" / "projects" / project_id / "state" / "caption_config.json").read_text(encoding="utf-8"),
                '{\n  "local_overwrite_mode": "skip",\n  "local_caption_mode": "tag",\n  "local_max_tokens": "1024",\n  "local_thinking_mode": true,\n  "local_prompt": "只输出短标签",\n  "api_thinking_mode": true,\n  "ollama_thinking_mode": true\n}',
            )

    def test_legacy_project_store_directory_is_migrated_to_new_brand_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy_projects_dir = root / ".lora_dataset_edit" / "projects"
            new_projects_dir = root / ".vision_dataset_studio" / "projects"

            legacy_store = ProjectStore(legacy_projects_dir)
            workspace = self._make_workspace(root)
            saved = legacy_store.save_project(name="迁移项目", workspace=workspace)
            project_id = saved["project"]["id"]

            migrated_store = ProjectStore(new_projects_dir, legacy_projects_dir=legacy_projects_dir)
            projects = migrated_store.list_projects()

            self.assertEqual(len(projects), 1)
            self.assertEqual(projects[0]["id"], project_id)
            self.assertTrue((new_projects_dir / project_id).is_dir())
            self.assertFalse((legacy_projects_dir / project_id).exists())
            reopened = migrated_store.get_project(project_id)
            self.assertEqual(reopened["project"]["name"], "迁移项目")
            self.assertEqual(
                reopened["workspace"]["dirs"]["result"],
                str((new_projects_dir / project_id / "assets" / "result").resolve()),
            )

    def test_legacy_migration_keeps_existing_new_project_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy_projects_dir = root / ".lora_dataset_edit" / "projects"
            new_projects_dir = root / ".vision_dataset_studio" / "projects"
            project_id = "20260528-120000-same-project"
            legacy_project_dir = legacy_projects_dir / project_id
            new_project_dir = new_projects_dir / project_id
            legacy_only_project_dir = legacy_projects_dir / "20260528-120001-legacy-only"

            for project_dir, name in (
                (legacy_project_dir, "旧项目"),
                (new_project_dir, "新项目"),
                (legacy_only_project_dir, "仅旧目录项目"),
            ):
                project_dir.mkdir(parents=True, exist_ok=True)
                (project_dir / "project.json").write_text(
                    f'{{"id":"{project_dir.name}","name":"{name}","control_count":1}}',
                    encoding="utf-8",
                )
                (project_dir / "workspace.json").write_text('{"settings":{"control_count":1},"dirs":{}}', encoding="utf-8")
                (project_dir / "manifest.json").write_text('{"items":[]}', encoding="utf-8")

            migrated_store = ProjectStore(new_projects_dir, legacy_projects_dir=legacy_projects_dir)
            projects = {row["id"]: row for row in migrated_store.list_projects()}

            self.assertEqual(projects[project_id]["name"], "新项目")
            self.assertIn("20260528-120001-legacy-only", projects)
            self.assertTrue((new_projects_dir / "20260528-120001-legacy-only").is_dir())


if __name__ == "__main__":
    unittest.main()
