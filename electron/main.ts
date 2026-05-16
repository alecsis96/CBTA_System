import { app, BrowserWindow } from 'electron'
import * as path from 'node:path'
import { registerIpcHandlers } from './ipc'
import { ensureBaseData } from './seed'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: 'CBTA Financieros',
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

  void win.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(() => {
  registerIpcHandlers()
  void ensureBaseData()
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
