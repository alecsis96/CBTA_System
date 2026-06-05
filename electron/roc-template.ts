import { shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import JSZipModule = require('jszip')
import { getGeneratedRocsDir, getPackagedAssetPath } from './runtime-paths'

const JSZip = JSZipModule

export type RocTemplateLine = {
  code: string
  name: string
  amount: number
}

export type RocTemplatePayload = {
  rocNumber: string
  fullName: string
  identifier: string
  address: string
  grade: string
  group: string
  shift: string
  printDate: string
  totalAmount: number
  amountInWords: string
  lines: RocTemplateLine[]
}

const TOP_BLOCK_OFFSET = 0
const BOTTOM_BLOCK_OFFSET = 33
const BLOCK_OFFSETS = [TOP_BLOCK_OFFSET, BOTTOM_BLOCK_OFFSET]
const DETAIL_ROW_OFFSETS = [20, 21, 22]
const WORKSHEET_REL_TEMPLATE_PATH = 'xl/worksheets/_rels/sheet1.xml.rels'
const WORKSHEET_TEMPLATE_PATH = 'xl/worksheets/sheet1.xml'
const WORKBOOK_PATH = 'xl/workbook.xml'
const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels'
const CONTENT_TYPES_PATH = '[Content_Types].xml'
const ROC_INITIAL_SHEET_COUNT = 3

function sanitizeSheetName(value: string, fallback: string) {
  const cleaned = value.replace(/[\[\]\*\?:\\/]/g, ' ').replace(/\s+/g, ' ').trim()
  const bounded = cleaned.slice(0, 31)
  return bounded || fallback
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function offsetAddress(address: string, rowOffset: number) {
  const match = address.match(/^([A-Z]+)(\d+)$/)
  if (!match) {
    return address
  }

  return `${match[1]}${Number(match[2]) + rowOffset}`
}

function normalizeCellAttributes(attributes: string) {
  return attributes
    .replace(/\s+t="[^"]*"/g, '')
    .replace(/\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function replaceCell(xml: string, address: string, value: string | number, type: 'string' | 'number') {
  const escapedAddress = escapeRegExp(address)
  const cellPattern = new RegExp(`<c([^>]*)r="${escapedAddress}"([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`, 'g')

  return xml.replace(cellPattern, (_match, before, after) => {
    const beforeAttrs = normalizeCellAttributes(before)
    const afterAttrs = normalizeCellAttributes(after)
    const attributes = [beforeAttrs, `r="${address}"`, afterAttrs].filter(Boolean).join(' ')
    if (type === 'number') {
      return `<c ${attributes}><v>${value}</v></c>`
    }

    return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
  })
}

function clearCell(xml: string, address: string) {
  return replaceCell(xml, address, '', 'string')
}

function applyOfficialRocPayload(xml: string, payload: RocTemplatePayload, rowOffset: number) {
  let nextXml = xml

  const writeString = (address: string, value: string) => {
    nextXml = replaceCell(nextXml, offsetAddress(address, rowOffset), value, 'string')
  }

  const writeNumber = (address: string, value: number) => {
    nextXml = replaceCell(nextXml, offsetAddress(address, rowOffset), value, 'number')
  }

  writeString('N4', payload.rocNumber)
  writeString('J7', payload.printDate)
  writeString('C10', payload.fullName)
  writeString('K11', payload.identifier)
  writeString('C14', payload.address)
  writeString('L14', payload.grade)
  writeString('N14', payload.group)
  writeString('O14', payload.shift)
  writeNumber('E17', payload.totalAmount)
  writeString('F17', `(${payload.amountInWords})`)
  writeNumber('N23', payload.totalAmount)

  DETAIL_ROW_OFFSETS.forEach((detailRowOffset, index) => {
    const line = payload.lines[index]
    const row = detailRowOffset
    if (!line) {
      ;['D', 'E', 'F', 'J', 'N'].forEach((column) => {
        nextXml = clearCell(nextXml, offsetAddress(`${column}${row}`, rowOffset))
      })
      return
    }

    writeNumber(`D${row}`, 1)
    writeString(`E${row}`, line.code)
    writeString(`F${row}`, line.name)
    writeNumber(`J${row}`, line.amount)
    writeNumber(`N${row}`, line.amount)
  })

  return nextXml
}

function clearOfficialRocPayload(xml: string, rowOffset: number) {
  let nextXml = xml
  const fields = ['N4', 'J7', 'C10', 'K11', 'C14', 'L14', 'N14', 'O14', 'E17', 'F17', 'N23']
  fields.forEach((address) => {
    nextXml = clearCell(nextXml, offsetAddress(address, rowOffset))
  })

  DETAIL_ROW_OFFSETS.forEach((detailRowOffset) => {
    ;['D', 'E', 'F', 'J', 'N'].forEach((column) => {
      nextXml = clearCell(nextXml, offsetAddress(`${column}${detailRowOffset}`, rowOffset))
    })
  })

  return nextXml
}

async function loadOfficialTemplateZip() {
  const templatePath = getPackagedAssetPath('roc 2026.xlsx')

  if (!fs.existsSync(templatePath)) {
    throw new Error('No se encontro la plantilla oficial roc 2026.xlsx en los recursos de la aplicacion.')
  }

  const buffer = await fs.promises.readFile(templatePath)
  const zip = await JSZip.loadAsync(buffer)
  return { templatePath, zip }
}

function removeWorksheetRelationshipEntries(relXml: string) {
  return relXml.replace(
    /<Relationship[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/worksheet"[^>]*\/>/g,
    '',
  )
}

function removeWorksheetContentTypeEntries(contentTypesXml: string) {
  return contentTypesXml.replace(
    /<Override PartName="\/xl\/worksheets\/sheet\d+\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.worksheet\+xml"\/>/g,
    '',
  )
}

function removeCalcChainEntries(contentTypesXml: string, relXml: string) {
  return {
    contentTypesXml: contentTypesXml.replace(
      /<Override PartName="\/xl\/calcChain\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.calcChain\+xml"\/>/g,
      '',
    ),
    relXml: relXml.replace(
      /<Relationship[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/calcChain"[^>]*\/>/g,
      '',
    ),
  }
}

function buildWorkbookXml(sheetNames: string[]) {
  const sheetsXml = sheetNames
    .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl" lastEdited="5" lowestEdited="5" rupBuild="9302"/><workbookPr defaultThemeVersion="124226"/><bookViews><workbookView xWindow="360" yWindow="315" windowWidth="23475" windowHeight="9765"/></bookViews><sheets>${sheetsXml}</sheets><calcPr calcId="144525" fullCalcOnLoad="1"/></workbook>`
}

function buildWorkbookRelationshipsXml(baseRelXml: string, sheetCount: number) {
  const otherRelationships = removeWorksheetRelationshipEntries(baseRelXml)
    .replace(/^<\?xml[^>]*>\s*/, '')
    .replace(/^<Relationships[^>]*>/, '')
    .replace(/<\/Relationships>\s*$/, '')
    .trim()

  const sheetRelationships = Array.from({ length: sheetCount }, (_value, index) => {
    const sheetNumber = index + 1
    return `<Relationship Id="rId${sheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelationships}${otherRelationships}</Relationships>`
}

function buildContentTypesXml(baseContentTypesXml: string, sheetCount: number) {
  const withoutWorksheets = removeWorksheetContentTypeEntries(baseContentTypesXml)
    .replace(/^<\?xml[^>]*>\s*/, '')
    .replace(/^<Types[^>]*>/, '')
    .replace(/<\/Types>\s*$/, '')
    .trim()

  const worksheetOverrides = Array.from({ length: sheetCount }, (_value, index) => {
    const sheetNumber = index + 1
    return `<Override PartName="/xl/worksheets/sheet${sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${worksheetOverrides}${withoutWorksheets}</Types>`
}

async function buildOfficialWorkbook(payloadPages: Array<[RocTemplatePayload, RocTemplatePayload | null]>) {
  const { zip } = await loadOfficialTemplateZip()
  const baseSheetXml = await zip.file(WORKSHEET_TEMPLATE_PATH)?.async('string')
  const baseSheetRelsXml = await zip.file(WORKSHEET_REL_TEMPLATE_PATH)?.async('string')
  const workbookRelXml = await zip.file(WORKBOOK_RELS_PATH)?.async('string')
  const contentTypesXml = await zip.file(CONTENT_TYPES_PATH)?.async('string')

  if (!baseSheetXml || !baseSheetRelsXml || !workbookRelXml || !contentTypesXml) {
    throw new Error('La plantilla oficial del ROC esta incompleta o no se pudo leer correctamente.')
  }

  for (let index = 0; index < payloadPages.length; index += 1) {
    const [topPayload, bottomPayload] = payloadPages[index]
    let sheetXml = clearOfficialRocPayload(baseSheetXml, TOP_BLOCK_OFFSET)
    sheetXml = clearOfficialRocPayload(sheetXml, BOTTOM_BLOCK_OFFSET)
    sheetXml = applyOfficialRocPayload(sheetXml, topPayload, TOP_BLOCK_OFFSET)

    if (bottomPayload) {
      sheetXml = applyOfficialRocPayload(sheetXml, bottomPayload, BOTTOM_BLOCK_OFFSET)
    }

    const sheetNumber = index + 1
    zip.file(`xl/worksheets/sheet${sheetNumber}.xml`, sheetXml)
    zip.file(`xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`, baseSheetRelsXml)
  }

  for (let sheetNumber = payloadPages.length + 1; sheetNumber <= ROC_INITIAL_SHEET_COUNT; sheetNumber += 1) {
    zip.remove(`xl/worksheets/sheet${sheetNumber}.xml`)
    zip.remove(`xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`)
  }

  const sheetNames = payloadPages.map(([topPayload, bottomPayload], index) =>
    sanitizeSheetName(bottomPayload ? `${topPayload.rocNumber}-${bottomPayload.rocNumber}` : topPayload.rocNumber, `Hoja${index + 1}`),
  )

  const withoutCalcChain = removeCalcChainEntries(contentTypesXml, workbookRelXml)
  zip.file(WORKBOOK_PATH, buildWorkbookXml(sheetNames))
  zip.file(WORKBOOK_RELS_PATH, buildWorkbookRelationshipsXml(withoutCalcChain.relXml, payloadPages.length))
  zip.file(CONTENT_TYPES_PATH, buildContentTypesXml(withoutCalcChain.contentTypesXml, payloadPages.length))
  zip.remove('xl/calcChain.xml')

  return zip
}

async function saveOfficialWorkbook(zip: InstanceType<typeof JSZip>, outputFileName: string) {
  const outputDir = getGeneratedRocsDir()
  await fs.promises.mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, outputFileName)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.promises.writeFile(outputPath, buffer)
  return outputPath
}

function createPayloadPages(payloads: RocTemplatePayload[]) {
  const pages: Array<[RocTemplatePayload, RocTemplatePayload | null]> = []
  for (let index = 0; index < payloads.length; index += 2) {
    pages.push([payloads[index], payloads[index + 1] ?? null])
  }
  return pages
}

export async function fillOfficialRocTemplate(payload: RocTemplatePayload) {
  const safeRoc = payload.rocNumber.replace(/[^a-zA-Z0-9-_]/g, '_')
  const zip = await buildOfficialWorkbook([[payload, null]])
  return saveOfficialWorkbook(zip, `${safeRoc}-${Date.now()}.xlsx`)
}

export async function exportOfficialRocTemplateBatch(payloads: RocTemplatePayload[], fileLabel: string) {
  if (payloads.length === 0) {
    throw new Error('No hay ROC para exportar en el periodo seleccionado.')
  }

  const safeLabel = fileLabel.replace(/[^a-zA-Z0-9-_]/g, '_')
  const zip = await buildOfficialWorkbook(createPayloadPages(payloads))
  return saveOfficialWorkbook(zip, `${safeLabel}-${Date.now()}.xlsx`)
}

export async function openOfficialRocTemplate(payload: RocTemplatePayload) {
  const outputPath = await fillOfficialRocTemplate(payload)
  const openResult = await shell.openPath(outputPath)

  if (openResult) {
    throw new Error(openResult)
  }

  return outputPath
}
