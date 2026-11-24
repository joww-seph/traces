import type { CardRow } from './card.js'

export type Audience = 'admin' | 'public'

export type RegistryRowIn = {
  id: string; rowNo: number; documentId: string; date: string; docType: 'ICS' | 'PAR'; reference: string; propertyNos: string[]; article: string; description: string
  estUsefulLifeYears: number | null; issuedTo: string | null; issuedQty: number; returnedQty: number; reissuedQty: number
  disposedQty: number; balanceQty: number; amountCentavos: number; remarks: string | null; fundCluster: string
}
export type ReportRowIn = {
  id: string; rowNo: number; documentId: string; article: string; description: string; propertyNos: string[]; unit: string; unitValueCentavos: number
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
    condition: 'serviceable' | 'unserviceable'; partOfSetNo: string | null
  }
  line: { id: string; cardId: string; category: 'semi' | 'ppe'; article: string; description: string; cardDescription: string; qty: number; unit: string
    unitCostCentavos: number; estUsefulLifeYears: number | null; dateAcquired: string | null; propertyTypeName: string }
  region: { page: number; x: number; y: number; w: number; h: number } | null
  document: {
    id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string
    pdfKind: 'uploaded' | 'generated' | null
    issuedBy: { name: string; position: string }; receivedBy: { name: string; position: string }
  }
  docLines: DocLineIn[]
  card: { propertyNo: string; rows: CardRow[] }
  registry: RegistryRowIn[]
  report: null | { officerName: string; officerPosition: string; asAt: string; rows: ReportRowIn[] }
}

const SEMI = 'SEMI-EXPENDABLE PROPERTY'

function opaque(prefix: string, audience: Audience) {
  const seen = new Map<string, string>()
  return (id: string) => (audience === 'admin' ? id : (seen.get(id) ?? (seen.set(id, `${prefix}${seen.size + 1}`), seen.get(id)!)))
}

export function buildPropertyView(d: PropertyViewData, audience: Audience) {
  const lineId = opaque('l', audience)
  const regId = opaque('g', audience)
  const cardId = opaque('c', audience)
  const rptId = opaque('r', audience)
  const isIcs = d.document.type === 'ICS'
  const lineAmount = d.line.qty * d.line.unitCostCentavos

  const pub = audience === 'public'
  const registryRows = pub ? d.registry.map((r) => (r.id === d.line.id ? r : { ...r, issuedTo: null })) : d.registry
  const reportRows = d.report?.rows
  const cardRows = pub ? d.card.rows.map((r) => (r.lineId === d.line.id ? r : { ...r, officer: null, officerFullName: null })) : d.card.rows
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
      ...(audience === 'admin' ? { cardId: d.line.cardId } : {}),
    },
    document: {
      type: d.document.type, docNo: d.document.docNo, fundCluster: d.document.fundCluster, issuedDate: d.document.issuedDate,
      issuedBy: d.document.issuedBy, receivedBy: d.document.receivedBy,
      pdfUrl: !d.document.pdfKind ? null : audience === 'public' ? `/api/public/q/${d.token}/pdf` : `/api/documents/${d.document.id}/pdf`,
      pdfRegion: d.document.pdfKind ? d.region : null,
      signed: d.document.pdfKind === 'uploaded',
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
            rows: reportRows.map(({ documentId, ...r }) => ({ ...r, id: rptId(r.id), ...(pub ? {} : { documentId }) })),
            highlightRowId: rptId(d.line.id),
          }
        : { empty: 'NOT_ISSUED' as const },
      registry: {
        header: {
          title: d.line.category === 'semi' ? `REGISTRY OF ${SEMI} ISSUED` : d.settings.ppeRegistryTitle,
          category: d.line.category, typeName: d.line.propertyTypeName, entityName: d.settings.entityName, fundCluster: d.document.fundCluster,
        },
        rows: registryRows.map(({ documentId, ...r }) => ({ ...r, id: regId(r.id), ...(pub ? {} : { documentId }) })),
        highlightRowId: regId(d.line.id),
      },
      card: {
        header: {
          title: d.line.category === 'semi' ? `${SEMI} CARD` : 'PROPERTY CARD', category: d.line.category,
          entityName: d.settings.entityName, fundCluster: d.document.fundCluster,
          article: d.line.article, description: d.line.cardDescription, typeName: d.line.propertyTypeName,
          propertyNo: d.card.propertyNo,
        },
        rows: cardRows.map(({ lineId: _line, ...r }) => ({ ...r, id: cardId(r.id), ...(audience === 'admin' ? { lineId: _line } : {}) })),
        highlightRowIds: highlightCard,
      },
    },
  }
}

export type PropertyView = ReturnType<typeof buildPropertyView>
