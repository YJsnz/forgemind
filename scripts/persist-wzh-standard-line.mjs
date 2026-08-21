import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const savePath = path.join(root, 'scripts', 'wzh-standard-line.json')
const save = JSON.parse(fs.readFileSync(savePath, 'utf8'))
const ownerId = 'd255c9ba-6d5f-45c3-ba71-384c709d528b'
const projectId = '5a9f8d38-9d26-11f1-91ad-f600815a8cf2'
const projectName = save.name
const escapedJson = JSON.stringify(save).replaceAll('\\', '\\\\').replaceAll("'", "''")
const escapedName = projectName.replaceAll("'", "''")

const sql = `
START TRANSACTION;
SET @owner_id = '${ownerId}';
SET @project_name = '${escapedName}';
SET @save_json = '${escapedJson}';
SET @project_id = (SELECT id FROM factory WHERE id = '${projectId}' AND owner_user_id = @owner_id LIMIT 1);
SET @project_id = COALESCE(@project_id, (SELECT id FROM factory WHERE owner_user_id = @owner_id AND name = @project_name LIMIT 1));
SET @project_id = COALESCE(@project_id, UUID());
INSERT INTO factory (id, owner_user_id, name, schema_version, width, depth, save_json)
VALUES (@project_id, @owner_id, @project_name, 6, 48, 48, JSON_EXTRACT(@save_json, '$'))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  schema_version = VALUES(schema_version),
  width = VALUES(width),
  depth = VALUES(depth),
  save_json = VALUES(save_json),
  updated_at = CURRENT_TIMESTAMP(6);
INSERT IGNORE INTO factory_member (factory_id, user_id, role)
VALUES (@project_id, @owner_id, 'owner');
INSERT INTO factory_autosave (owner_user_id, name, schema_version, save_json)
VALUES (@owner_id, @project_name, 6, JSON_EXTRACT(@save_json, '$'))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  schema_version = VALUES(schema_version),
  save_json = VALUES(save_json),
  updated_at = CURRENT_TIMESTAMP(6);
COMMIT;
SELECT id, owner_user_id, name, schema_version, JSON_LENGTH(save_json, '$.objects') AS object_count, JSON_LENGTH(save_json, '$.floorNames') AS floor_count
FROM factory WHERE id = @project_id AND owner_user_id = @owner_id;
`

const result = spawnSync('docker', ['exec', '-i', 'forgemind-mysql', 'mysql', '--default-character-set=utf8mb4', '-uforgemind', '-pforgemind', '-D', 'forgemind'], {
  input: sql,
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'MySQL 写入失败\n')
  process.exit(result.status ?? 1)
}
process.stdout.write(result.stdout)
