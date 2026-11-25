import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dangerReasons, isDangerous } from '../src/shared/danger'

test('comandos perigosos são reconhecidos; os comuns não', () => {
  for (const c of [
    'rm -rf storage/',
    'php artisan migrate:fresh --seed',
    'docker compose down -v',
    'git push --force origin main',
    'git reset --hard HEAD~3',
    'DROP TABLE users;',
    'DELETE FROM pedidos;',
    'Remove-Item .\\dist -Recurse -Force'
  ]) {
    assert.ok(isDangerous(c), c)
  }
  for (const c of ['php artisan migrate', 'npm run dev', 'docker compose up -d', 'docker compose down', 'git push -u origin MAS-1', 'DELETE FROM pedidos WHERE id = 3;', 'rm arquivo.txt']) {
    assert.ok(!isDangerous(c), c)
  }
  assert.deepEqual(dangerReasons('docker compose down --volumes'), ['remove os containers e os volumes (dados do banco)'])
})
