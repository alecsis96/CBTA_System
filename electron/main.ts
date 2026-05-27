import { app, BrowserWindow } from 'electron'
import * as path from 'node:path'
import { initializeDatabaseEnvironment } from './db-bootstrap'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: 'CBTA 44 Sistema',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
    return
  }

  void win.loadFile(path.join(app.getAppPath(), 'dist/index.html'))
}

app.whenReady().then(async () => {
  initializeDatabaseEnvironment()

  const [{ registerIpcHandlers }, { ensureBaseData }] = await Promise.all([
    import('./ipc'),
    import('./seed'),
  ])

  registerIpcHandlers()
  try {
    await ensureBaseData()
  } catch (error) {
    console.error('[startup] Seed initialization failed. Continuing app startup.', error)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
