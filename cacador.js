import { chromium } from 'playwright'
import notifier from 'node-notifier'

const CONFIG = {
  cdpUrl: 'http://localhost:9222',
  tags: ['Comercial', 'Novo cliente'],
}

function notificar(nomeCliente) {
  notifier.notify({
    title: '🎯 Caçador — Novo Cliente!',
    message: `Cliente capturado: ${nomeCliente}`,
    sound: false,
  })
}

async function capturarCliente(page, cliente) {
  console.log(`\n🎯 Capturando: ${cliente.nome}`)
  try {
    await page.click('div[data-id="atend_aguard"]')
    await page.waitForTimeout(800)

    const itens = await page.$$('div.list_dados div.atend_aguard')
    for (const item of itens) {
      const titulo = await item.$eval('div.title', el => el.innerText.trim()).catch(() => '')
      if (titulo.includes(cliente.nome.split(' ')[0])) {
        await item.click()
        await page.waitForTimeout(1500)
        await page.click('button:has-text("Iniciar atendimento")')
        console.log(`✅ Atendimento iniciado: ${cliente.nome}`)
        notificar(cliente.nome)
        await page.waitForTimeout(500)
        await page.click('div[data-id="chat"]')
        return
      }
    }
    console.warn('⚠️ Cliente não encontrado no DOM')
    await page.click('div[data-id="chat"]').catch(() => {})
  } catch (err) {
    console.error('Erro ao capturar:', err.message)
  }
}

async function main() {
  console.log('🤖 Conectando no Chrome...')

  const browser = await chromium.connectOverCDP(CONFIG.cdpUrl)
  const context = browser.contexts()[0]
  const pages = context.pages()

  const page = pages.find(p => p.url().includes('opasuite.fenixwireless'))
  if (!page) {
    console.error('❌ Aba do OPA não encontrada.')
    process.exit(1)
  }

  console.log('✅ OPA encontrado:', page.url())
  console.log('👀 Interceptando WebSocket em tempo real...\n')

  // Controle para não capturar o mesmo cliente duas vezes seguidas
  let ultimoCapturado = null
  let capturandoAgora = false

  // Playwright intercepta todas as conexões WebSocket da página nativamente
  page.on('websocket', ws => {
    console.log('🔌 WebSocket conectado:', ws.url())

    ws.on('framereceived', async ({ payload }) => {
      try {
        // Socket.IO usa prefixo numérico (ex: "42[...]"), remove ele
        const texto = typeof payload === 'string' ? payload : payload.toString()
        if (!texto.startsWith('42')) return

        const json = texto.slice(2) // remove o "42"
        const dados = JSON.parse(json)

        // dados = ["nomeEvento", ...args]
        const evento = dados[0]
        if (evento !== 'atendimentosListagem') return

        const clientes = dados[1]
        const tipo = dados[2]

        if (tipo !== 'atend_aguard') return
        if (!clientes || clientes.length === 0) {
          process.stdout.write('.')
          return
        }

        console.log(`\n🔔 Fila atualizada: ${clientes.length} cliente(s)`)

        // Loga todos os clientes e suas tags para debug
        for (const c of clientes) {
          const tags = (c.tags || c.etiquetas || c.labels || []).map(t => t.nome || t.name || t.label || t)
          console.log(`  → ${c.nome || c.name} | tags: ${JSON.stringify(tags)}`)
        }

        // Filtra o alvo
        const alvo = clientes.find(c => {
          const tags = (c.tags || c.etiquetas || c.labels || []).map(t => t.nome || t.name || t.label || t)
          return CONFIG.tags.every(tag => tags.includes(tag))
        })

        if (!alvo) return
        if (capturandoAgora) return
        if (ultimoCapturado === (alvo.id || alvo._id)) return

        ultimoCapturado = alvo.id || alvo._id
        capturandoAgora = true

        await capturarCliente(page, {
          id: alvo.id || alvo._id,
          nome: alvo.nome || alvo.name
        })

        capturandoAgora = false

      } catch (_) {
        // Mensagem que não é JSON válido — ignora silenciosamente
      }
    })
  })

  // Mantém processo vivo
  await new Promise(() => {})
}

main()