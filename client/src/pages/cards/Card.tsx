import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ApiError, api } from '@/api'
import { ExportButton } from '@/components/ExportButton'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { CardPanel } from '@/components/PropertyTabs'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CardRow } from '@/lib/propertyView'
import { useSettings } from '@/lib/queries'

type CardView = {
  header: {
    id: string; category: 'semi' | 'ppe'; article: string; description: string; unit: string; active?: boolean
    propertyTypeCode: string; propertyTypeName: string; propertyNoFirst: string | null; propertyNoLast: string | null
  }
  rows: CardRow[]
}

// Fix the article, model or unit of a card, or retire it so it is no longer offered on new entries.
function EditCard({ card, open, onClose }: { card: CardView['header']; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [v, setV] = useState({ article: card.article, description: card.description, unit: card.unit, active: card.active !== false })
  const save = useMutation({
    mutationFn: () => api.patch(`/api/items/${card.id}`, { article: v.article.trim(), description: v.description.trim(), unit: v.unit.trim(), active: v.active }),
    onSuccess: () => { for (const k of ['card', 'cards', 'items']) qc.invalidateQueries({ queryKey: [k] }); toast.success('Card updated'); onClose() },
    onError: (e) => toast.error(e instanceof ApiError && e.code === 'ITEM_EXISTS' ? 'Another card already has this article and model.' : e instanceof ApiError ? e.message : 'Could not save'),
  })
  const field = (k: 'article' | 'description' | 'unit', label: string) => (
    <div className="grid gap-1.5"><Label htmlFor={`c-${k}`}>{label}</Label><Input id={`c-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
  )
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit card</DialogTitle>
          <DialogDescription>Changes show on the card, the registry and the reports. The category and property type stay as they are.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (v.article.trim() && v.description.trim() && v.unit.trim()) save.mutate(); else toast.error('Article, model and unit are required.') }} noValidate>
          {field('article', 'Article')}
          {field('description', 'Model')}
          {field('unit', 'Unit')}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Offer this card on new entries
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save card</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// The property card of one model: SPC for semi-expendable, PC for PPE. Every issuance of the model is a row.
export default function Card() {
  const { itemId = '' } = useParams()
  const { data: settings } = useSettings()
  const [editing, setEditing] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['card', itemId], retry: false,
    queryFn: () => api.get<CardView>(`/api/views/card/${encodeURIComponent(itemId)}`),
  })
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading card</p>
  if (error || !data) {
    return <EmptyState title="Card not found" action={<Link to="/cards" className={buttonVariants()}>Back to the cards</Link>}>The link may be wrong, or the card was removed.</EmptyState>
  }
  const h = data.header
  const semi = h.category === 'semi'
  const title = semi ? 'SEMI-EXPENDABLE PROPERTY CARD' : 'PROPERTY CARD'
  return (
    <>
      <PageHeader crumbs={[{ label: 'Cards', to: '/cards' }, { label: h.article }]}
        title={title} description={`${h.article} · ${h.description}${h.active === false ? ' · retired' : ''}`}
        actions={<>
          <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit card</Button>
          <ExportButton path={`/api/exports/${semi ? 'spc' : 'pc'}?itemId=${h.id}`} label={semi ? 'Export SPC' : 'Export PC'} />
        </>} />
      <CardPanel card={{
        header: {
          title, category: h.category, entityName: settings?.entityName ?? '', fundCluster: settings?.defaultFundCluster ?? '',
          article: h.article, description: h.description, typeName: h.propertyTypeName, propertyNoFirst: h.propertyNoFirst, propertyNoLast: h.propertyNoLast,
        },
        rows: data.rows, highlightRowIds: [],
      }} />
      {editing && <EditCard card={h} open={editing} onClose={() => setEditing(false)} />}
    </>
  )
}
