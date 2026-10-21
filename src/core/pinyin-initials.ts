/**
 * pinyin-initials —— 姓名转拼音首字母（v8.3.337+）
 *
 * 用于 Git 分支后缀兜底：子任务 owner 未显式配置后缀时，
 * 自动取姓名拼音首字母作为分支后缀（张三 → -zs，John → -j，张三丰 → -zsf）。
 * 中文用 pinyin-pro 逐字转拼音取首字母；英文段取单词首字母；非字母字符跳过。
 */
import { pinyin } from 'pinyin-pro';

/**
 * 姓名 → 拼音首字母串（小写）
 * - 张三 → zs
 * - 张三丰 → zsf
 * - John → j
 * - 张三 John → zsj
 * 空串/纯符号 → ''
 */
export function toPinyinInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  let out = '';
  // 按「连续汉字 / 连续字母 / 其他」切分段落：
  // 汉字段逐字转拼音取首字母（张三 → zs）；字母段视为一个英文词取首字母（John → j）；
  // 空格/符号段跳过。注意 pinyin-pro 的 type:'array' 对非汉字按单字符切分，
  // 直接遍历会把 John 拆成 j-o-h-n，故先自行分段。
  const segments = trimmed.split(/([\u4e00-\u9fa5]+|[a-zA-Z]+)/).filter(Boolean);
  for (const seg of segments) {
    if (/^[\u4e00-\u9fa5]+$/.test(seg)) {
      const arr = pinyin(seg, { toneType: 'none', type: 'array' }) as string[];
      for (const py of arr) {
        if (py && /[a-z]/i.test(py[0])) out += py[0].toLowerCase();
      }
    } else if (/^[a-zA-Z]+$/.test(seg)) {
      out += seg[0].toLowerCase();
    }
  }
  return out;
}
