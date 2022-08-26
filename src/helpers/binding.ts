export function getBindingExpressionFromAttribute(value: string): string {
  return value.replace('{{', '').replace('}}', '').trim();
}

export function isBinding(value: any): boolean {
  let isBinding;

  if (typeof value === 'string') {
    const str = value.trim();
    isBinding = str.indexOf('{{') === 0 && str.lastIndexOf('}}') === str.length - 2;
  }

  return isBinding;
}