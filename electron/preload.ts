import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('cbta', {
  appName: 'CBTA 44 Sistema',
  auth: {
    login: (input: unknown) => ipcRenderer.invoke('auth:login', input),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session'),
  },
  admin: {
    listDepartments: () => ipcRenderer.invoke('admin:departments:list'),
    listUsers: () => ipcRenderer.invoke('admin:users:list'),
    createUser: (input: unknown) => ipcRenderer.invoke('admin:users:create', input),
    updateUser: (userId: string, input: unknown) => ipcRenderer.invoke('admin:users:update', userId, input),
    resetUserPassword: (userId: string, input: unknown) => ipcRenderer.invoke('admin:users:resetPassword', userId, input),
  },
  students: {
    list: () => ipcRenderer.invoke('students:list'),
    listValidated: () => ipcRenderer.invoke('students:listValidated'),
    get: (studentId: string) => ipcRenderer.invoke('students:get', studentId),
    getNextInternalFolioPreview: () => ipcRenderer.invoke('students:getNextInternalFolioPreview'),
    getRequirementChecklist: (studentId: string) => ipcRenderer.invoke('students:getRequirementChecklist', studentId),
    saveRequirementChecklist: (studentId: string, input: unknown) => ipcRenderer.invoke('students:saveRequirementChecklist', studentId, input),
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
    updateSuggested: (input: unknown) => ipcRenderer.invoke('concepts:updateSuggested', input),
  },
  payments: {
    create: (input: unknown) => ipcRenderer.invoke('payments:create', input),
    list: (filters?: unknown) => ipcRenderer.invoke('payments:list', filters),
    generateBatch: (input: unknown) => ipcRenderer.invoke('payments:generateBatch', input),
  },
    receipts: {
      create: (input: unknown) => ipcRenderer.invoke('receipts:create', input),
      listByStudent: (studentId: string) => ipcRenderer.invoke('receipts:listByStudent', studentId),
      listAll: () => ipcRenderer.invoke('receipts:listAll'),
      getNextRocNumber: () => ipcRenderer.invoke('receipts:getNextRocNumber'),
      getConfig: () => ipcRenderer.invoke('receipts:getConfig'),
      updateConfig: (input: unknown) => ipcRenderer.invoke('receipts:updateConfig', input),
      openOfficialTemplate: (input: unknown) => ipcRenderer.invoke('receipts:openOfficialTemplate', input),
      reprint: (receiptId: string) => ipcRenderer.invoke('receipts:reprint', receiptId),
      cancel: (input: unknown) => ipcRenderer.invoke('receipts:cancel', input),
      printBatch: (input: unknown) => ipcRenderer.invoke('receipts:printBatch', input),
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
    listAssignedRoster: (input: unknown) => ipcRenderer.invoke('groups:listAssignedRoster', input),
    importAssignedRoster: (input: unknown) => ipcRenderer.invoke('groups:importAssignedRoster', input),
    exportAssignedRoster: (input: unknown) => ipcRenderer.invoke('groups:exportAssignedRoster', input),
    printAssignedRoster: (input: unknown) => ipcRenderer.invoke('groups:printAssignedRoster', input),
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
