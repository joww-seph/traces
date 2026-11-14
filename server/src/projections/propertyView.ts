// Pure: assembles the four-tab PropertyView (design §9) from already-loaded data.
// 'admin' sees real ids and the whole registry; 'public' gets opaque short row ids, only this document's registry rows,
// and no UUID anywhere (BR-12).
import type { CardRow } from './card.js'

export type Audience = 'admin' | 'public'

export type RegistryRowIn = {
  id: string; date: string; docType: 'ICS' | 'PAR'; reference: string; propertyNos: string[]; article: string; description: string
  estUsefulLifeYears: number | null; issuedTo: string | null; issuedQty: number; returnedQty: number; reissuedQty: number
  disposedQty: number; balanceQty: number; amountCentavos: number; remarks: string | null; fundCluster: string
}
export type CountRowIn = {
  id: string; article: string; description: string; propertyNo: string; unit: string; unitValueCentavos: number
  balancePerCard: number; qtyOnHand: number | null; shortageOverageQty: number | null; shortageOverageValueCentavos: number | null; remarks: string | null
}
export type DocLineIn = {
  id: string; lineNo: number; qty: number; unit: string; unitCostCentavos: number; description: string; article: string
  estUsefulLifeYears: number | null; dateAcquired: string | null; properties: { propertyNo: string }[]
}

export type PropertyViewData = {
  token: string | null
  settings: { entityName: string; ppeRegistryTitle: string }
  property: { id: string; propertyNo: string; serialNo: string | null; oldPropertyNo: string | null; componentLabel: string | null; condition: 'serviceable' | 'unserviceable' }
  line: { id: string; category: 'semi' | 'ppe'; article: string; description: string; qty: number; unit: string; unitCostCentavos: number
    estUsefulLifeYears: number | null; dateAcquired: string | null }
  region: { page: number; x: number; y: number; w: number; h: number } | null
  document: {
    id: string; type: 'ICS' | 'PAR'; docNo: string; fundCluster: string; issuedDate: string; hasPdf: boolean
    issuedBy: { name: string; position: string }; receivedBy: { name: string; position: string }
  }
  docLines: DocLineIn[]
  card: CardRow[]
  registry: RegistryRowIn[]
  count: null | {
    typeLabel: string; asAt: string; fundCluster: string; officerName: string; officerPosition: string; assumptionDate: string | null
    status: 'open' | 'closed'; signatories: { role: string; name: string; position: string | null }[]; rows: CountRowIn[]
  }
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
  const sameDoc = (r: RegistryRowIn) => r.reference === `${d.document.type} ${d.document.docNo}`
  const registryRows = audience === 'public' ? d.registry.filter(sameDoc) : d.registry
  const isIcs = d.document.type === 'ICS'
  const lineAmount = d.line.qty * d.line.unitCostCentavos
  const lastCard = d.card.at(-1)

  return {
    property: {
      propertyNo: d.property.propertyNo, serialNo: d.property.serialNo, oldPropertyNo: d.property.oldPropertyNo,
      componentLabel: d.property.componentLabel, condition: d.property.condition, category: d.line.category,
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
      report: d.count
        ? {
            header: {
              title: d.line.category === 'semi' ? `REPORT ON THE PHYSICAL COUNT OF ${SEMI}` : 'REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT',
              typeLabel: d.count.typeLabel, asAt: d.count.asAt, fundCluster: d.count.fundCluster, entityName: d.settings.entityName,
              officerName: d.count.officerName, officerPosition: d.count.officerPosition, assumptionDate: d.count.assumptionDate,
              status: d.count.status, signatories: d.count.signatories,
            },
            rows: d.count.rows.map((r) => ({ ...r, id: r.id })),
            highlightRowId: d.property.propertyNo,
          }
        : { empty: 'NOT_COUNTED' as const },
      registry: {
        header: {
          title: d.line.category === 'semi' ? `REGISTRY OF ${SEMI} ISSUED` : d.settings.ppeRegistryTitle,
          category: d.line.category, entityName: d.settings.entityName, fundCluster: d.document.fundCluster,
        },
        rows: registryRows.map((r) => ({ ...r, id: regId(r.id) })),
        highlightRowId: regId(d.line.id),
      },
      card: {
        header: {
          title: d.line.category === 'semi' ? `${SEMI} CARD` : 'PROPERTY CARD', category: d.line.category,
          entityName: d.settings.entityName, fundCluster: d.document.fundCluster, propertyNo: d.property.propertyNo,
          article: d.line.article, description: d.line.description,
        },
        rows: d.card.map((r) => ({ ...r, id: cardId(r.id) })),
        highlightRowId: lastCard ? cardId(lastCard.id) : null,
      },
    },
  }
}

export type PropertyView = ReturnType<typeof buildPropertyView>
