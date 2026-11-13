import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type DocRow = { id: string; type: 'ICS' | 'PAR'; docNo: string; issuedDate: string; receivedByShort: string }

export default function Dashboard() {
  const { data } = useQuery({ queryKey: ['documents', 'recent'], queryFn: () => api.get<{ rows: DocRow[] }>('/api/documents') })

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Button render={<Link to="/documents/new" />} nativeButton={false}>New ICS/PAR</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent documents</CardTitle></CardHeader>
        <CardContent>
          {!data?.rows.length ? (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="divide-y">
              {data.rows.slice(0, 8).map((d) => (
                <li key={d.id} className="flex justify-between py-2 text-sm">
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
