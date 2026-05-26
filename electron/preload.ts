import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('cbta', {
  appName: 'CBTA Financieros',
  auth: {
    login: (input: unknown) => ipcRenderer.invoke('auth:login', input),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session'),
  },
  students: {
    list: () => ipcRenderer.invoke('students:list'),
    listValidated: () => ipcRenderer.invoke('students:listValidated'),
    get: (studentId: string) => ipcRenderer.invoke('students:get', studentId),
    create: (input: unknown) => ipcRenderer.invoke('students:create', input),
    update: (studentId: string, input: unknown) => ipcRenderer.invoke('students:update', studentId, input),
  },
  preRegistrations: {
    list: () => ipcRenderer.invoke('preRegistrations:list'),
    create: (input: unknown) => ipcRenderer.invoke('preRegistrations:create', input),
    updateStatus: (preRegistrationId: string, input: unknown) =>
      ipcRenderer.invoke('preRegistrations:updateStatus', preRegistrationId, input),
    exportSep: (input?: unknown) => ipcRenderer.invoke('preRegistrations:exportSep', input),
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
    printBatch: () => ipcRenderer.invoke('receipts:printBatch'),
  },
  groups: {
    createForIntake: (input: unknown) => ipcRenderer.invoke('groups:createForIntake', input),
    listForIntake: (input: unknown) => ipcRenderer.invoke('groups:listForIntake', input),
    autoAssign: (input: unknown) => ipcRenderer.invoke('groups:autoAssign', input),
    confirmAssignment: (input: unknown) => ipcRenderer.invoke('groups:confirmAssignment', input),
    manualReassign: (input: unknown) => ipcRenderer.invoke('groups:manualReassign', input),
    markNoShow: (input: unknown) => ipcRenderer.invoke('groups:markNoShow', input),
    stats: (input: unknown) => ipcRenderer.invoke('groups:stats', input),
    preview: (input: unknown) => ipcRenderer.invoke('groups:preview', input),
    previewRoster: (input: unknown) => ipcRenderer.invoke('groups:previewRoster', input),
  },
  audit: {
    listRecent: () => ipcRenderer.invoke('audit:listRecent'),
  },
  admissions: {
    list: (filters?: unknown) => ipcRenderer.invoke('admissions:list', filters),
    createPayment: (input: unknown) => ipcRenderer.invoke('admissions:createPayment', input),
    startCapture: (admissionId: string) => ipcRenderer.invoke('admissions:startCapture', admissionId),
    completeCapture: (admissionId: string, studentId: string) =>
      ipcRenderer.invoke('admissions:completeCapture', admissionId, studentId),
    markPrinted: (admissionId: string) => ipcRenderer.invoke('admissions:markPrinted', admissionId),
    findByFolioOrCurp: (query: string) => ipcRenderer.invoke('admissions:findByFolioOrCurp', query),
    printPaymentReceipt: (payload: unknown) => ipcRenderer.invoke('admissions:printPaymentReceipt', payload),
    printFicha: (payload: unknown) => ipcRenderer.invoke('admissions:printFicha', payload),
  },
})
