const COMMAND_PREFIXES = [
  'intro:',
  'say:',
  'changeBg:',
  'changeFigure:',
  'choose:',
  'label:',
  'jumpLabel:',
  'callScene:',
  'setVar:'
];

const LAST_LINE_ALLOWED = ['choose:', 'end;'];

function checkLineCommand(line, index) {
  if (line === 'end;') {
    return { ok: true };
  }
  const prefix = COMMAND_PREFIXES.find((cmd) => line.startsWith(cmd));
  if (!prefix) {
    if (line.startsWith(':')) {
      return { ok: true };
    }
    if (/^[A-Za-z0-9 _()[\]<>#"'.,-]+:/i.test(line)) {
      return { ok: true };
    }
    return { ok: false, error: `第 ${index + 1} 行命令无效：${line}` };
  }
  return { ok: true };
}

function checkChooseLine(line, totalLines) {
  if (!line.startsWith('choose:')) {
    return { ok: false, error: `最后一行必须是 choose: 或 end;，当前为：${line}` };
  }
  const body = line.slice(7, -1).trim(); // remove 'choose:' and trailing ';'
  if (!body) {
    return { ok: false, error: 'choose: 语句缺少内容' };
  }
  const parts = body.split('|');
  if (parts.length !== 2) {
    return { ok: false, error: 'choose: 必须包含恰好两个选项' };
  }
  for (const item of parts) {
    const segments = item.split(':');
    if (segments.length < 2) {
      return { ok: false, error: `选项格式错误：${item}` };
    }
    const target = segments.slice(-1)[0];
    if (!/^runtime\/[A-Za-z0-9_\-/]+\.txt$/.test(target)) {
      return { ok: false, error: `选项跳转目标无效：${target}` };
    }
  }
  return { ok: true };
}

function checkScript(text) {
  const errors = [];
  if (!text || typeof text !== 'string') {
    return { ok: false, errors: ['脚本为空'] };
  }
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { ok: false, errors: ['脚本没有有效内容'] };
  }
  const minLines = Number(process.env.WEBGAL_RUNTIME_SLICE_MIN ?? 4);
  const maxLines = Number(process.env.WEBGAL_RUNTIME_SLICE_MAX ?? 9);
  if (lines.length < minLines || lines.length > maxLines) {
    errors.push(`脚本行数必须 ${minLines}~${maxLines} 行`);
  }
  lines.forEach((line, index) => {
    if (!line.endsWith(';')) {
      errors.push(`第 ${index + 1} 行缺少分号`);
    }
    if (/[：；—]/.test(line)) {
      errors.push(`第 ${index + 1} 行包含中文标点：${line}`);
    }
    if (LAST_LINE_ALLOWED.includes(line)) {
      return;
    }
    const { ok, error } = checkLineCommand(line, index);
    if (!ok) {
      errors.push(error);
    }
  });
  const lastLine = lines[lines.length - 1];
  if (lastLine !== 'end;') {
    if (!lastLine.startsWith('choose:')) {
      errors.push(`最后一行必须是 choose: 或 end;，当前为：${lastLine}`);
    } else {
      const body = lastLine.replace(/^choose:/, '').replace(/;$/, '').trim();
      if (!body) {
        errors.push('choose: 语句缺少内容');
      } else {
        const parts = body.split('|');
        if (parts.length !== 2) {
          errors.push('choose: 必须包含恰好两个选项');
        }
        for (const item of parts) {
          const segments = item.split(':');
          if (segments.length < 2) {
            errors.push(`选项格式错误：${item}`);
            continue;
          }
          const target = segments.slice(-1)[0];
          if (!/^runtime\/[A-Za-z0-9_\-/]+\.txt$/.test(target)) {
            errors.push(`选项跳转目标无效：${target}`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  checkScript,
};
