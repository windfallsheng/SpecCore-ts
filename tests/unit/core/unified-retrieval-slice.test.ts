import { describe, it, expect } from 'vitest';
import { sliceCodeFile } from '../../../src/core/unified-retrieval';

/**
 * v8.3.365 回归测试：sliceCodeFile 截断 bug 修复
 * 根因：签名行的括号未计入深度，函数体的 `{` 不在计数内，
 * 第一个空行/首个闭合块就被误判「函数结束」，切片只剩函数头几行。
 * 修复：签名行括号先计深度再进 body 循环。
 */
describe('sliceCodeFile 函数体完整性（v8.3.365 修复）', () => {
  it('带空行与嵌套 if 的函数：body 应覆盖到函数结束', () => {
    const src = [
      '/**',
      ' * 用户登录：校验密码强度、失败次数锁定',
      ' */',
      'export function login(username: string, password: string, attemptCount: number) {',
      '',
      '  if (attemptCount >= 5) {',
      "    throw new Error('账号已锁定');",
      '  }',
      '  if (!password || password.length < 8) {',
      "    throw new Error('密码长度不足');",
      '  }',
      '  return { token: "mock" };',
      '}',
      '',
      'export function next() {}',
    ].join('\n');

    const slices = sliceCodeFile(src, 'auth.ts');
    const login = slices.find(s => s.name === 'login');
    expect(login).toBeTruthy();
    // 函数体必须覆盖到 return 与收尾 }（此前首个空行处就截断）
    expect(login!.body).toContain('attemptCount >= 5');
    expect(login!.body).toContain('密码长度不足');
    expect(login!.body).toContain('return { token: "mock" }');
  });

  it('前端组件：useState 与事件处理器逻辑进入切片', () => {
    const src = [
      'export function LoginPage() {',
      "  const [agreed, setAgreed] = useState(false);",
      '',
      '  const handleSubmit = () => {',
      '    if (!agreed) {',
      "      showToast('请先勾选用户协议');",
      '      return;',
      '    }',
      '    doLogin();',
      '  };',
      '',
      '  return <div onClick={handleSubmit}>登录</div>;',
      '}',
    ].join('\n');

    const slices = sliceCodeFile(src, 'LoginPage.tsx');
    const page = slices.find(s => s.name === 'LoginPage');
    expect(page).toBeTruthy();
    expect(page!.body).toContain('请先勾选用户协议');
    expect(page!.body).toContain('onClick={handleSubmit}');
  });

  it('箭头函数变量：body 提取完整', () => {
    const src = [
      'export const checkStock = (sku: string, quantity: number, stock: number) => {',
      '  if (stock <= 0) {',
      "    throw new Error('已售罄');",
      '  }',
      '  return true;',
      '};',
    ].join('\n');

    const slices = sliceCodeFile(src, 'stock.ts');
    const check = slices.find(s => s.name === 'checkStock');
    expect(check).toBeTruthy();
    expect(check!.body).toContain('已售罄');
    expect(check!.body).toContain('return true');
  });

  it('interface 声明：body 到闭合 } 为止，不被空行截断', () => {
    const src = [
      'export interface OrderInfo {',
      '  orderId: string;',
      '',
      '  amount: number;',
      '}',
    ].join('\n');

    const slices = sliceCodeFile(src, 'types.ts');
    const itf = slices.find(s => s.name === 'OrderInfo');
    expect(itf).toBeTruthy();
    expect(itf!.body).toContain('orderId');
    expect(itf!.body).toContain('amount');
  });
});
