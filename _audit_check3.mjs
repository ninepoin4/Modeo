import { importCcv3 } from './src/characters/ccv3.js';
import * as m from './src/characters/manager.js';

// CCv3 with multi-line mes_example (typical real-world card)
const ccv3 = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'MultilineTest',
    description: 'desc',
    mes_example:
      '<START>\n{{user}}: 你好\n{{char}}: 嗨！\n这是第二行台词\n<START>\n{{user}}: 再问\n{{char}}: 答',
    first_mes: 'hello',
  },
};
try {
  const character = importCcv3(ccv3);
  console.log('import OK, example_messages:', JSON.stringify(character.example_messages));
  const saved = m.saveCharacter(JSON.stringify(character).length ? null : null);
  console.log('unreachable');
} catch (e) {
  console.log('FAIL:', e.message);
}

// Try the real save path
try {
  const character = importCcv3(ccv3);
  const { stringifyYaml } = await import('./src/core/yaml.js');
  const yaml = stringifyYaml(character);
  console.log('--- stringified yaml ---');
  console.log(yaml.slice(0, 400));
  const saved = m.saveCharacter(yaml);
  console.log('saved OK:', saved.id);
  m.deleteCharacter(saved.id);
} catch (e) {
  console.log('SAVE FAIL:', e.message);
}
