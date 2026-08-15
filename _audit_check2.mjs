import { isDangerous, isSensitiveAccess } from './src/tools/shellTool.js';
import { isRiskyTestScript } from './src/tools/runTestsTool.js';

const cmds = [
  'rm --force -r build',
  'rm -r --force build',
  'cat .env',
  'cat ".env"',
  'type "id_rsa"',
  'Stop-Computer -Force',
  'poweroff',
  'Remove-Item -Recurse C:\\x',
  'rm -r f',
  'del /q /s x',
  'shutdown -s -t 0',
  'net user hacker pass /add',
];
for (const c of cmds) {
  console.log(JSON.stringify(c), '=> dangerous:', isDangerous(c), '| sensitive:', isSensitiveAccess(c));
}

console.log('--- run_tests risky scripts ---');
const scripts = [
  'node scripts/test.js',
  'node -e "require(\'child_process\').execSync(\'rm -rf x\')"',
  'powershell -Command "Remove-Item -Recurse C:\\x"',
  'rm -rf build',
  'cmd /c del /s /q x',
];
for (const s of scripts) {
  console.log(JSON.stringify(s), '=> risky:', isRiskyTestScript(s));
}
