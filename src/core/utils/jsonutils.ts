import * as fs from 'fs/promises';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const writeFileAtomic = require('write-file-atomic');

export function safeLoadJson(data: string): any {
  try {
    return JSON.parse(data);
  } catch (error) {
    return fixJson(data);
  }
}

function fixJson(data: string): any {
  const value: string[] = [];
  const stack = [];
  let ind = 0;
  let current = data[0];
  if (current != '{') {
    return null;
  }

  stack.push(current);
  value.push(current);
  while (stack.length > 0 && ind < data.length) {
    ind++;
    current = data[ind];
    if (current == '{') {
      stack.push(current);
    } else if (current == '}') {
      stack.pop();
    }
    value.push(current);
  }

  return JSON.parse(value.join(''));
}

export async function makeSureJsonFile(filepath: string) {
  let content;
  try {
    content = await fs.readFile(filepath, { encoding: 'utf-8' });
  } catch (error) {
    // no file or access, ignore and continue
    return;
  }

  try {
    JSON.parse(content);
    // valid json
    return;
  } catch (error) {
    console.error(`Invalid '${filepath}' JSON file, fixing it...`);
    console.error(`Previous '${filepath}' content: ${content}`);
    const data = fixJson(content);
    if (!data) {
      throw new Error(`Failed to fix '${filepath}' file. Content: ${content}`);
    }
    const fixedContent = JSON.stringify(data);
    await writeFileAtomic(filepath, fixedContent, { encoding: 'utf-8' });
    console.error(`Fixed ${filepath} file!`);
    console.error(`Fixed '${filepath}' content: ${fixedContent}`);
  }
}
