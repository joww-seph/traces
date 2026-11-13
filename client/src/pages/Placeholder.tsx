// Stand-in for pages built in later tasks.
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-background p-8 text-center">
      <h1 className="text-lg font-medium">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
    </div>
  )
}
