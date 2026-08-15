import * as m from './src/characters/manager.js';
import fs from 'node:fs';

// Input YAML that parses fine: rule with embedded \n escape inside inline array
const yaml = `name: 多行规则角色
rules: ["第一条", "多行\\n规则内容"]
tags: [a, b]`;

try {
  const c = m.saveCharacter(yaml);
  console.log('save OK, id=', c.id);
  m.deleteCharacter(c.id);
  console.log('cleaned up');
} catch (e) {
  console.log('SAVE FAIL:', e.message);
  // check what remains on disk
  const files = fs.readdirSync('characters').filter((f) => f.endsWith('.yaml') && !['example.yaml', 'wanxia.yaml'].includes(f));
  console.log('leftover files:', files);
  if (files.length) {
    const text = fs.readFileSync('characters/' + files[0], 'utf8');
    console.log('--- leftover content ---');
    console.log(text.slice(0, 300));
    fs.unlinkSync('characters/' + files[0]);
    console.log('removed leftover');
  }
}
