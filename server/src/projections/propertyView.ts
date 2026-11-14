// Pure: assembles the four-tab PropertyView (design §9, Update 01 U-09) from already-loaded data.
// 'admin' sees real ids, the whole model card and the whole registry; 'public' gets opaque short row ids and only
// this line's card rows and this document's registry/report rows, with no UUID anywhere (BR-12, SEC-10).
import type { CardRow } from './card.js'

export type Audience = 'admin' | 'public'

export type RegistryRowIn = {
  id: string; date: string; docType: 'ICS' | 'PAR'; reference: string; propertyNos: string[]; article: string; description: string
  estUsefulLifeYears: number | null; issuedTo: string | null; issuedQty: number; returnedQty: number; reissuedQty: number
  disposedQty: number; balanceQty: number; amountCentavos: number; remarks: string | null; fundCluster: string
}
export type ReportRowIn = {
  id: string; article: string; description: string; propertyNos: string[]; unit: string; unitValueCentavos: number
  balancePerCard: number; reference: string; remarks: string | null
}
export type DocLineIn = {
  id: string; lineNo: number; qty: number; unit: string; unitCostCentavos: number; description: string; article: string
  estUsefulLifeYears: number | null; dateAcquired: string | null; properties: { propertyNo: string; componentLabel?: string | null }[]
}

export type PropertyViewData = {
  token: string | null
  settings: { entityName: string; ppeRegistryTitle: string }
  property: {
    id: string; propertyNo: string; serialNo: string | null; oldPropertyNo: string | null; componentLabel: string | null
    condition: 'serviceable' | 'unserviceable'; partOfSetNo: string | null // the main number of the set when this is a component
  }
  line: { id: string; category: 'semi' | 'ppe'; article: string; description: string; itemDescription: string; qty: number; unit: string
    unitCostCentavos: number; estUsefulLifeYears: number | null; dateAcquired: string | null; propertyTypeName: string }
  region: { page: number; x: number; y: number; w: number; h: number } | null
  document: {
    id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string; hasPdf: boolean
    issuedBy: { name: string; position: string }; receivedBy: { name: string; position: string }
  }
  docLines: DocLineIn[]
  card: { propertyNoFirst: string | null; propertyNoLast: string | null; rows: CardRow[] }
  registry: RegistryRowIn[]
  // the property's current holder's report as at today; null = nobody holds it
  report: null | { officerName: string; officerPosition: string; asAt: string; rows: ReportRowIn[] }
}

const SEMI = 'SEMI-EXPENDABLE PROPERTY'

// Opaque ids are stable inside one response (rows and highlight agree) but reveal nothing about the database.
function opaque(prefix: string, audience: Audience) {
  const seen = new Map<string, string>()
  return (id: string) => (audience === 'admin' ? id : (seen.get(id) ?? (seen.set(id, `${prefix}${seen.size + 1}`), seen.get(id)!)))
}

export function buildPropertyView(d: PropertyViewData, audience: Audience) {
  const lineId = opaque('l', audience)
  const regId = opaque('g', audience)
  const cardId = opaque('c', audience)
  const rptId = opaque('r', audience)
  const docRef = `${d.document.type} ${d.document.docNo}`
  const isIcs = d.document.type === 'ICS'
  const lineAmount = d.line.qty * d.line.unitCostCentavos

  const registryRows = audience === 'public' ? d.registry.filter((r) => r.reference === docRef) : d.registry
  const reportRows = d.report && (audience === 'public' ? d.report.rows.filter((r) => r.reference === docRef) : d.report.rows)
  // the whole model card for staff; only this line's rows for the public (other officers' issuances stay private)
  const cardRows = audience === 'public' ? d.card.rows.filter((r) => r.lineId === d.line.id) : d.card.rows
  // the card header's number range: the whole card for staff, only this line's main units for the public
  const mine = d.docLines.find((l) => l.id === d.line.id)?.properties.filter((p) => !p.componentLabel).map((p) => p.propertyNo).sort() ?? []
  const range = audience === 'public' ? { first: mine[0] ?? null, last: mine.at(-1) ?? null } : { first: d.card.propertyNoFirst, last: d.card.propertyNoLast }
  const highlightCard = cardRows.filter((r) => r.lineId === d.line.id).map((r) => cardId(r.id))

  return {
    property: {
      propertyNo: d.property.propertyNo, serialNo: d.property.serialNo, oldPropertyNo: d.property.oldPropertyNo,
      componentLabel: d.property.componentLabel, partOfSetNo: d.property.partOfSetNo, condition: d.property.condition, category: d.line.category,
      ...(audience === 'admin' ? { token: d.token } : {}),
    },
    line: {
      article: d.line.article, description: d.line.description, qty: d.line.qty, unit: d.line.unit,
      unitCostCentavos: d.line.unitCostCentavos, totalCostCentavos: lineAmount,
      estUsefulLifeYears: d.line.estUsefulLifeYears, dateAcquired: d.line.dateAcquired,
    },
    document: {
      type: d.document.type, docNo: d.document.docNo, fundCluster: d.document.fundCluster, issuedDate: d.document.issuedDate,
      issuedBy: d.document.issuedBy, receivedBy: d.document.receivedBy,
      pdfUrl: !d.document.hasPdf ? null : audience === 'public' ? `/api/public/q/${d.token}/pdf` : `/api/documents/${d.document.id}/pdf`,
      pdfRegion: d.region,
    },
    tabs: {
      icsPar: {
        header: { title: isIcs ? 'INVENTORY CUSTODIAN SLIP' : 'PROPERTY ACKNOWLEDGMENT RECEIPT', type: d.document.type, docNo: d.document.docNo,
          fundCluster: d.document.fundCluster, entityName: d.settings.entityName },
        rows: d.docLines.map((l) => ({
          id: lineId(l.id), lineNo: l.lineNo, qty: l.qty, unit: l.unit, unitCostCentavos: l.unitCostCentavos,
          totalCostCentavos: l.qty * l.unitCostCentavos, description: l.description, propertyNos: l.properties.map((p) => p.propertyNo),
          estUsefulLifeYears: l.estUsefulLifeYears, dateAcquired: l.dateAcquired,
        })),
        highlightRowId: lineId(d.line.id),
      },
      report: d.report && reportRows
        ? {
            header: {
              title: d.line.category === 'semi' ? `REPORT ON THE PHYSICAL COUNT OF ${SEMI}` : 'REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT',
              typeLabel: d.line.propertyTypeName, asAt: d.report.asAt, fundCluster: d.document.fundCluster, entityName: d.settings.entityName,
              officerName: d.report.officerName, officerPosition: d.report.officerPosition,
            },
            rows: reportRows.map((r) => ({ ...r, id: rptId(r.id) })),
            highlightRowId: rptId(d.line.id),
          }
        : { empty: 'NOT_ISSUED' as const },
      registry: {
        header: {
          title: d.line.category === 'semi' ? `REGISTRY OF ${SEMI} ISSUED` : d.settings.ppeRegistryTitle,
          category: d.line.category, typeName: d.line.propertyTypeName, entityName: d.settings.entityName, fundCluster: d.document.fundCluster,
        },
        rows: registryRows.map((r) => ({ ...r, id: regId(r.id) })),
        highlightRowId: regId(d.line.id),
      },
      card: {
        header: {
          title: d.line.category === 'semi' ? `${SEMI} CARD` : 'PROPERTY CARD', category: d.line.category,
          entityName: d.settings.entityName, fundCluster: d.document.fundCluster,
          article: d.line.article, description: d.line.itemDescription, typeName: d.line.propertyTypeName,
          propertyNoFirst: range.first, propertyNoLast: range.last,
        },
        rows: cardRows.map(({ lineId: _line, ...r }) => ({ ...r, id: cardId(r.id), ...(audience === 'admin' ? { lineId: _line } : {}) })),
        highlightRowIds: highlightCard,
      },
    },
  }
}

export type PropertyView = ReturnType<typeof buildPropertyView>
