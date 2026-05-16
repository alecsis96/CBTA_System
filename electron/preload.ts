import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('cbta', {
  appName: 'CBTA Financieros',
  students: {
    list: () => ipcRenderer.invoke('students:list'),
    listValidated: () => ipcRenderer.invoke('students:listValidated'),
    get: (studentId: string) => ipcRenderer.invoke('students:get', studentId),
    create: (input: unknown) => ipcRenderer.invoke('students:create', input),
    update: (studentId: string, input: unknown) => ipcRenderer.invoke('students:update', studentId, input),
  },
  concepts: {
    listActive: () => ipcRenderer.invoke('concepts:listActive'),
    updateTariff: (input: unknown) => ipcRenderer.invoke('concepts:updateTariff', input),
  },
  receipts: {
    create: (input: unknown) => ipcRenderer.invoke('receipts:create', input),
    listByStudent: (studentId: string) => ipcRenderer.invoke('receipts:listByStudent', studentId),
    listAll: () => ipcRenderer.invoke('receipts:listAll'),
    openOfficialTemplate: (input: unknown) => ipcRenderer.invoke('receipts:openOfficialTemplate', input),
    reprint: (receiptId: string) => ipcRenderer.invoke('receipts:reprint', receiptId),
  },
  audit: {
    listRecent: () => ipcRenderer.invoke('audit:listRecent'),
  },
})
