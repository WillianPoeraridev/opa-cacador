import CDP from 'chrome-remote-interface'
import notifier from 'node-notifier'

const CONFIG = {
  host: 'localhost',
  port: 9222,
  setorAlvo: 'Comercial',
  tagAlvo: 'Novo cliente',
}

function notificar(nomeCliente) {
  notifier.notify({
    title: '🎯 Caçador — Novo Cliente!',
    message: `Cliente capturado: ${nomeCliente}`,
    sound: false,
  })
}

async function getOpaTab() {
  const resp = await fetch(`http://${CONFIG.host}:${CONFIG.port}/json`)
  const tabs = await resp.json()
  return tabs.find(t => t.url && t.url.includes('opasuite.fenixwireless'))
}

async function capturarCliente(clienteNome) {
  console.log(`\n🎯 Capturando: ${clienteNome}`)
  try {
    const tab = await getOpaTab()
    const client2 = await CDP({ host: CONFIG.host, port: CONFIG.port, target: tab.id })
    const { Runtime } = client2

    const exec = (expression) => Runtime.evaluate({ expression, awaitPromise: true })

    // Abre a fila
    await exec(`document.querySelector('div[data-id="atend_aguard"]').click()`)

    // Loop: tenta clicar no card assim que aparecer (max 5s)
    const primeiroNome = clienteNome.split(' ')[0]
    let cardClicado = false
    const inicioCard = Date.now()
    while (!cardClicado && Date.now() - inicioCard < 5000) {
      const result = await exec(`
        (function() {
          const itens = document.querySelectorAll('div.list_dados div.atend_aguard')
          for (const item of itens) {
            const titulo = item.querySelector('div.title')
            if (titulo && titulo.innerText.includes('${primeiroNome}')) {
              titulo.click()
              return 'ok'
            }
          }
          return 'aguardando'
        })()
      `)
      if (result.result?.value === 'ok') {
        cardClicado = true
      } else {
        await new Promise(r => setTimeout(r, 50))
      }
    }
    if (!cardClicado) console.warn('⚠️ Card não encontrado em 5s')
    // Fica tentando clicar em Atender até conseguir (max 5s)
    let clicou = false
    const inicio = Date.now()
    while (!clicou && Date.now() - inicio < 5000) {
      const btnResult = await exec(`
        (function() {
          const btn = document.querySelector('button.orange')
          if (btn) { btn.click(); return 'ok' }
          return 'aguardando'
        })()
      `)
      if (btnResult.result?.value === 'ok') {
        clicou = true
      } else {
        await new Promise(r => setTimeout(r, 100))
      }
    }
    if (!clicou) console.warn('⚠️ Botão Atender não apareceu em 5s')

    // Volta pro chat
    await exec(`document.querySelector('div[data-id="chat"]').click()`)

    console.log(`✅ Atendimento iniciado: ${clienteNome}`)
    notificar(clienteNome)
    await client2.close()

  } catch (err) {
    console.error('Erro ao capturar:', err.message)
  }
}

async function main() {
  console.log('🤖 Conectando via CDP direto...')

  const tab = await getOpaTab()
  if (!tab) {
    console.error('❌ Aba do OPA não encontrada.')
    process.exit(1)
  }

  console.log('✅ OPA encontrado:', tab.url)

  const client = await CDP({ host: CONFIG.host, port: CONFIG.port, target: tab.id })
  const { Network } = client

  await Network.enable()

  // Previne throttling do Chrome em abas em background
  try {
    const { Page } = client
    await Page.enable()
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  } catch(_) {}

  // Mantém a aba "viva" com um ping a cada 10s
  setInterval(async () => {
    try {
      await client.send('Runtime.evaluate', { expression: '1' })
    } catch(_) {}
  }, 10000)

  console.log('👀 Escutando fila em tempo real...\n')

  let ultimoCapturado = null
  let capturandoAgora = false

  Network.webSocketFrameReceived(async ({ response }) => {
    try {
      const texto = response.payloadData
      if (!texto.startsWith('42')) return

      const dados = JSON.parse(texto.slice(2))
      if (dados[0] !== 'atendimentosListagem') return

      const clientes = dados[1]
      const tipo = dados[2]

      if (tipo !== 'atend_aguard') return
      if (!clientes || clientes.length === 0) { process.stdout.write('.'); return }

      console.log(`\n🔔 Fila: ${clientes.length} cliente(s)`)

      for (const c of clientes) {
        // Nome: tenta id_cliente primeiro, depois id_user
        const nome = c.id_cliente?.nome || c.id_user?.nome || 'desconhecido'
        const setor = c.setor?.nome || ''
        
        // Tags: formato { id_tag: { nome: '...' } }
        const tags = (c.tags || []).map(t => t.id_tag?.nome || t.nome || t.name || t).filter(Boolean)

        console.log(`  → ${nome} | setor: ${setor} | tags: [${tags.join(', ')}]`)

        const temSetor = setor === CONFIG.setorAlvo
        const temTag = tags.includes(CONFIG.tagAlvo)

        if (temSetor && temTag) {
          if (capturandoAgora) continue
          console.log(`  🎯 ALVO ENCONTRADO!`)
          ultimoCapturado = c._id
          capturandoAgora = true
          await capturarCliente(nome)
          capturandoAgora = false
          return
        }
      }

    } catch (err) {
      console.error('Erro:', err.message)
    }
  })

  await new Promise(() => {})
}

main()