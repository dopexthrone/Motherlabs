
export const keys = Object.keys(process.env);
console.log('Env vars:', keys.join(', '));
const dangerous = keys.filter(k => 
  k.includes('KEY') || k.includes('SECRET') || k.includes('TOKEN') || 
  k.includes('ANTHROPIC') || k.includes('OPENAI')
);
if (dangerous.length > 0) {
  console.error('SECURITY FAIL: Found dangerous env vars:', dangerous);
  process.exit(1);
}
console.log('No dangerous env vars leaked');
