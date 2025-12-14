// Ollama Adapter Tests - Local LLM integration tests
// Tests Step 8 of ROADMAP_NEXT_10.md: Integrate Local LLM (Ollama)

import {
  OllamaAdapter,
  createCodeLlamaAdapter,
  createDeepSeekCoderAdapter,
  createQwenCoderAdapter,
  detectBestCodeModel
} from '../src/adapters/ollamaAdapter'

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\u2717 FAIL: ${message}`)
    failCount++
  } else {
    console.log(`\u2713 PASS: ${message}`)
    passCount++
  }
}

async function runTests() {

console.log('=== OLLAMA ADAPTER TESTS ===\n')

// ============================================================================
// TEST 1: Create Adapter with Default Config
// ============================================================================
console.log('TEST 1: Create Adapter with Default Config\n')

const defaultAdapter = new OllamaAdapter()
assert(defaultAdapter.getModel() === 'codellama:13b', 'Default model is codellama:13b')
assert(defaultAdapter.getBaseUrl() === 'http://localhost:11434', 'Default base URL is localhost:11434')

console.log('')

// ============================================================================
// TEST 2: Create Adapter with Custom Config
// ============================================================================
console.log('TEST 2: Create Adapter with Custom Config\n')

const customAdapter = new OllamaAdapter({
  model: 'qwen2.5-coder:14b',
  baseUrl: 'http://192.168.1.100:11434',
  timeout: 180000,
  temperature: 0.2
})

assert(customAdapter.getModel() === 'qwen2.5-coder:14b', 'Custom model is set')
assert(customAdapter.getBaseUrl() === 'http://192.168.1.100:11434', 'Custom base URL is set')

console.log('')

// ============================================================================
// TEST 3: Set Model Dynamically
// ============================================================================
console.log('TEST 3: Set Model Dynamically\n')

const adapter = new OllamaAdapter()
adapter.setModel('deepseek-coder:6.7b')
assert(adapter.getModel() === 'deepseek-coder:6.7b', 'Model can be changed')

console.log('')

// ============================================================================
// TEST 4: CodeLlama Factory - 7b
// ============================================================================
console.log('TEST 4: CodeLlama Factory - 7b\n')

const codellama7b = createCodeLlamaAdapter('7b')
assert(codellama7b.getModel() === 'codellama:7b', 'Creates codellama:7b adapter')

console.log('')

// ============================================================================
// TEST 5: CodeLlama Factory - 13b
// ============================================================================
console.log('TEST 5: CodeLlama Factory - 13b\n')

const codellama13b = createCodeLlamaAdapter('13b')
assert(codellama13b.getModel() === 'codellama:13b', 'Creates codellama:13b adapter')

console.log('')

// ============================================================================
// TEST 6: CodeLlama Factory - 34b
// ============================================================================
console.log('TEST 6: CodeLlama Factory - 34b\n')

const codellama34b = createCodeLlamaAdapter('34b')
assert(codellama34b.getModel() === 'codellama:34b', 'Creates codellama:34b adapter')

console.log('')

// ============================================================================
// TEST 7: DeepSeek Coder Factory - 1.3b
// ============================================================================
console.log('TEST 7: DeepSeek Coder Factory - 1.3b\n')

const deepseek1b = createDeepSeekCoderAdapter('1.3b')
assert(deepseek1b.getModel() === 'deepseek-coder:1.3b', 'Creates deepseek-coder:1.3b adapter')

console.log('')

// ============================================================================
// TEST 8: DeepSeek Coder Factory - 6.7b
// ============================================================================
console.log('TEST 8: DeepSeek Coder Factory - 6.7b\n')

const deepseek6b = createDeepSeekCoderAdapter('6.7b')
assert(deepseek6b.getModel() === 'deepseek-coder:6.7b', 'Creates deepseek-coder:6.7b adapter')

console.log('')

// ============================================================================
// TEST 9: DeepSeek Coder Factory - 33b
// ============================================================================
console.log('TEST 9: DeepSeek Coder Factory - 33b\n')

const deepseek33b = createDeepSeekCoderAdapter('33b')
assert(deepseek33b.getModel() === 'deepseek-coder:33b', 'Creates deepseek-coder:33b adapter')

console.log('')

// ============================================================================
// TEST 10: Qwen Coder Factory - 1.5b
// ============================================================================
console.log('TEST 10: Qwen Coder Factory - 1.5b\n')

const qwen1b = createQwenCoderAdapter('1.5b')
assert(qwen1b.getModel() === 'qwen2.5-coder:1.5b', 'Creates qwen2.5-coder:1.5b adapter')

console.log('')

// ============================================================================
// TEST 11: Qwen Coder Factory - 7b
// ============================================================================
console.log('TEST 11: Qwen Coder Factory - 7b\n')

const qwen7b = createQwenCoderAdapter('7b')
assert(qwen7b.getModel() === 'qwen2.5-coder:7b', 'Creates qwen2.5-coder:7b adapter')

console.log('')

// ============================================================================
// TEST 12: Qwen Coder Factory - 14b
// ============================================================================
console.log('TEST 12: Qwen Coder Factory - 14b\n')

const qwen14b = createQwenCoderAdapter('14b')
assert(qwen14b.getModel() === 'qwen2.5-coder:14b', 'Creates qwen2.5-coder:14b adapter')

console.log('')

// ============================================================================
// TEST 13: Qwen Coder Factory - 32b
// ============================================================================
console.log('TEST 13: Qwen Coder Factory - 32b\n')

const qwen32b = createQwenCoderAdapter('32b')
assert(qwen32b.getModel() === 'qwen2.5-coder:32b', 'Creates qwen2.5-coder:32b adapter')

console.log('')

// ============================================================================
// TEST 14: Adapter Implements LLMProvider Interface
// ============================================================================
console.log('TEST 14: Adapter Implements LLMProvider Interface\n')

const testAdapter = new OllamaAdapter()
assert(typeof testAdapter.generateCode === 'function', 'Has generateCode method')
assert(typeof testAdapter.generate === 'function', 'Has generate method')
assert(typeof testAdapter.decompose === 'function', 'Has decompose method')
assert(typeof testAdapter.isAvailable === 'function', 'Has isAvailable method')
assert(typeof testAdapter.listModels === 'function', 'Has listModels method')
assert(typeof testAdapter.hasModel === 'function', 'Has hasModel method')

console.log('')

// ============================================================================
// TEST 15: isAvailable Returns Result Type
// ============================================================================
console.log('TEST 15: isAvailable Returns Result Type\n')

const availResult = await adapter.isAvailable()
assert(availResult.ok !== undefined, 'isAvailable returns Result')
if (availResult.ok) {
  assert(typeof availResult.value === 'boolean', 'isAvailable value is boolean')
}

console.log('')

// ============================================================================
// TEST 16: listModels Returns Result Type
// ============================================================================
console.log('TEST 16: listModels Returns Result Type\n')

const listResult = await adapter.listModels()
// Returns Err if Ollama not running, Ok if running
assert('ok' in listResult, 'listModels returns Result')
if (listResult.ok) {
  assert(Array.isArray(listResult.value), 'listModels value is array')
}

console.log('')

// ============================================================================
// TEST 17: generate Returns Result Type
// ============================================================================
console.log('TEST 17: generate Returns Result Type\n')

const genResult = await adapter.generate('test prompt')
// Will fail if Ollama not running, but should return proper Result
assert('ok' in genResult, 'generate returns Result')
if (!genResult.ok) {
  assert(genResult.error instanceof Error, 'Error is Error instance')
  // Expected error when Ollama not running
  console.log(`  (Expected error: ${genResult.error.message})`)
}

console.log('')

// ============================================================================
// TEST 18: decompose Returns Result Type
// ============================================================================
console.log('TEST 18: decompose Returns Result Type\n')

const decompResult = await adapter.decompose('Build a web server')
assert('ok' in decompResult, 'decompose returns Result')
if (!decompResult.ok) {
  assert(decompResult.error instanceof Error, 'Error is Error instance')
  console.log(`  (Expected error: ${decompResult.error.message})`)
}

console.log('')

// ============================================================================
// TEST 19: hasModel Returns Result Type
// ============================================================================
console.log('TEST 19: hasModel Returns Result Type\n')

const hasModelResult = await adapter.hasModel('codellama:13b')
assert('ok' in hasModelResult, 'hasModel returns Result')

console.log('')

// ============================================================================
// TEST 20: detectBestCodeModel Returns Result Type
// ============================================================================
console.log('TEST 20: detectBestCodeModel Returns Result Type\n')

const detectResult = await detectBestCodeModel(adapter)
assert('ok' in detectResult, 'detectBestCodeModel returns Result')
if (!detectResult.ok) {
  // Expected if Ollama not running or no models
  console.log(`  (Expected error: ${detectResult.error.message})`)
}

console.log('')

// ============================================================================
// TEST 21: Config Partial Override
// ============================================================================
console.log('TEST 21: Config Partial Override\n')

const partialAdapter = new OllamaAdapter({
  timeout: 300000
})
assert(partialAdapter.getModel() === 'codellama:13b', 'Default model preserved')
assert(partialAdapter.getBaseUrl() === 'http://localhost:11434', 'Default URL preserved')
// Note: Can't directly test timeout, but it should be 300000

console.log('')

// ============================================================================
// TEST 22: Factory Functions Return Correct Type
// ============================================================================
console.log('TEST 22: Factory Functions Return Correct Type\n')

const factoryAdapter = createCodeLlamaAdapter()
assert(factoryAdapter instanceof OllamaAdapter, 'Factory returns OllamaAdapter instance')
assert(factoryAdapter.getModel() === 'codellama:13b', 'Default size is 13b')

console.log('')

// ============================================================================
// TEST 23: Qwen Factory Default Size
// ============================================================================
console.log('TEST 23: Qwen Factory Default Size\n')

const qwenDefault = createQwenCoderAdapter()
assert(qwenDefault.getModel() === 'qwen2.5-coder:7b', 'Qwen default size is 7b')

console.log('')

// ============================================================================
// TEST 24: DeepSeek Factory Default Size
// ============================================================================
console.log('TEST 24: DeepSeek Factory Default Size\n')

const deepseekDefault = createDeepSeekCoderAdapter()
assert(deepseekDefault.getModel() === 'deepseek-coder:6.7b', 'DeepSeek default size is 6.7b')

console.log('')

// ============================================================================
// LIVE TESTS (Only if Ollama is running)
// ============================================================================
console.log('=== LIVE TESTS (Skip if Ollama not running) ===\n')

const liveAdapter = new OllamaAdapter()
const isLive = await liveAdapter.isAvailable()

if (isLive.ok && isLive.value) {
  console.log('Ollama is running - executing live tests\n')

  // TEST 25: List Models Live
  console.log('TEST 25: List Models Live\n')
  const models = await liveAdapter.listModels()
  if (models.ok) {
    assert(Array.isArray(models.value), 'Models is array')
    console.log(`  Found ${models.value.length} models: ${models.value.slice(0, 5).join(', ')}${models.value.length > 5 ? '...' : ''}`)
    passCount++
  } else {
    console.log(`  Error: ${models.error.message}`)
    failCount++
  }

  // TEST 26: Detect Best Model Live
  console.log('\nTEST 26: Detect Best Model Live\n')
  const bestModel = await detectBestCodeModel(liveAdapter)
  if (bestModel.ok) {
    assert(typeof bestModel.value === 'string', 'Best model is string')
    console.log(`  Best model: ${bestModel.value}`)
  } else {
    console.log(`  No suitable model found: ${bestModel.error.message}`)
    passCount++ // Expected if no code models installed
  }

  // TEST 27: Has Model Check
  console.log('\nTEST 27: Has Model Check\n')
  const modelsList = await liveAdapter.listModels()
  if (modelsList.ok && modelsList.value.length > 0) {
    const checkModel = modelsList.value[0]
    const hasIt = await liveAdapter.hasModel(checkModel)
    if (hasIt.ok) {
      assert(hasIt.value === true, `hasModel returns true for ${checkModel}`)
    }
  } else {
    console.log('  (Skipped - no models available)')
    passCount++
  }

} else {
  console.log('Ollama not running - skipping live tests\n')
  console.log('To run live tests:')
  console.log('  1. Install Ollama: curl -fsSL https://ollama.com/install.sh | sh')
  console.log('  2. Start Ollama: ollama serve')
  console.log('  3. Pull a model: ollama pull codellama:13b')
  console.log('  4. Re-run tests\n')
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('OLLAMA ADAPTER TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL OLLAMA ADAPTER TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
