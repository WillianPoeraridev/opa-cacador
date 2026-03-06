import CDP from 'chrome-remote-interface'
import notifier from 'node-notifier'

const CONFIG = {
  host: 'localhost',
  port: 9222,
  setorAlvo: 'Comercial',
  tagAlvo: 'Novo cliente',
}

import { exec } from 'child_process'

function notificar(nomeCliente) {
  const msg = `Cliente capturado: ${nomeCliente}`
  exec(`powershell -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg}', 'Caçador OPA', 'OK', 'Information')"`)
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
    await new Promise(r => setTimeout(r, 1000))

    // Clica no card do cliente pelo nome
    const primeiroNome = clienteNome.split(' ')[0]
    const result = await exec(`
      (function() {
        const itens = document.querySelectorAll('div.list_dados div.atend_aguard')
        for (const item of itens) {
          const titulo = item.querySelector('div.title')
          if (titulo && titulo.innerText.includes('${primeiroNome}')) {
            titulo.click()
            return 'clicado: ' + titulo.innerText
          }
        }
        return 'nao encontrado'
      })()
    `)
    console.log('Card:', result.result?.value)
    await new Promise(r => setTimeout(r, 1500))

    // Clica em Atender (button.orange)
    const btnResult = await exec(`
      (function() {
        const btn = document.querySelector('button.orange')
        if (btn) { btn.click(); return 'ok: ' + btn.innerText }
        return 'botao nao encontrado'
      })()
    `)
    console.log('Botão:', btnResult.result?.value)
    await new Promise(r => setTimeout(r, 500))

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
          if (capturandoAgora || ultimoCapturado === c._id) continue
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