import * as m from './src/characters/manager.js';

const yaml = `name: 测试角色
rules:
  - 第一条规则
  - 多行规则
    第二行
  - 第三条`;

try {
  const c = m.saveCharacter(yaml);
  console.log('save OK, id=', c.id);
  const back = m.loadCharacter(c.id);
  console.log('load OK, rules=', JSON.stringify(back.rules));
  m.deleteCharacter(c.id);
} catch (e) {
  console.log('FAIL:', e.message);
}
