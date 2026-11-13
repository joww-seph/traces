import { useQuery } from '@tanstack/react-query'
import { formatPeso } from '@traces/shared'
import { Link } from 'react-router'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type DocRow = { id: string; type: 'ICS' | 'PAR'; docNo: string; issuedDate: string; receivedByShort: string }
type Stat = { properties: number; mainUnits: number; valueCentavos: number }
type Summary = { documents: { ICS: number; PAR: number }; categories: { semi: Stat; ppe: Stat } }

function CategoryCard({ title, stat }: { title: string; stat?: Stat }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="grid gap-1">
        <p className="text-2xl font-semibold">{stat ? formatPeso(stat.valueCentavos) : '—'}</p>
        <p className="text-sm text-muted-foreground">
          {stat ? `${stat.mainUnits} item${stat.mainUnits === 1 ? '' : 's'} · ${stat.properties} property number${stat.properties === 1 ? '' : 's'}` : 'Loading…'}
        </p>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const docs = useQuery({ queryKey: ['documents', 'recent'], queryFn: () => api.get<{ rows: DocRow[] }>('/api/documents') })
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Summary>('/api/dashboard') })
  const s = summary.data

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Button render={<Link to="/documents/new" />} nativeButton={false}>New ICS/PAR</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <CategoryCard title="Semi-expendable" stat={s?.categories.semi} />
        <CategoryCard title="Property, plant & equipment" stat={s?.categories.ppe} />
        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent className="grid gap-1">
            <p className="text-2xl font-semibold">{s ? s.documents.ICS + s.documents.PAR : '—'}</p>
            <p className="text-sm text-muted-foreground">{s ? `${s.documents.ICS} ICS · ${s.documents.PAR} PAR` : 'Loading…'}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent documents</CardTitle></CardHeader>
        <CardContent>
          {!docs.data?.rows.length ? (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="divide-y">
              {docs.data.rows.slice(0, 8).map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-x-4 py-2 text-sm">
                  <Link to={`/documents/${d.id}`} className="font-medium hover:underline">{d.type} {d.docNo}</Link>
                  <span className="text-muted-foreground">{d.receivedByShort} · {d.issuedDate}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
