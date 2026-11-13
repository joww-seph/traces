import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { AppError, errorHandler } from '../middleware/error.js'
import { validate } from '../middleware/validate.js'

afterAll(() => pool.end())

describe('app', () => {
  it('GET /api/health runs select 1', async () => {
    const res = await request(createApp()).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, db: true })
  })

  it('unknown /api route -> 404 in the error shape', async () => {
    const res = await request(createApp()).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('malformed JSON -> 400', async () => {
    const res = await request(createApp()).post('/api/health').set('Content-Type', 'application/json').send('{bad')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_JSON')
  })
})

// Throwaway app: each route throws one kind of error so we can check the central mapping.
function errApp() {
  const app = express()
  app.use(express.json())
  app.post('/zod', validate(z.object({ n: z.number() })), (_req, res) => res.json({ ok: true }))
  app.get('/app', () => { throw new AppError('TEAPOT', 418, 'short and stout', { a: 1 }) })
  app.get('/async', async () => { throw new AppError('LATER', 409) })
  const pgErr = (code: string, extra: object = {}) => () => { throw Object.assign(new Error('pg'), { code, ...extra }) }
  app.get('/pg23505', pgErr('23505', {
    constraint: 'properties_property_no_uq',
    detail: 'Key (upper(property_no))=(2026-09ICT-0199) already exists.',
  }))
  app.get('/pg23503', pgErr('23503'))
  app.get('/pg23514', pgErr('23514', { constraint: 'lines_qty_positive' }))
  app.get('/boom', () => { throw new Error('secret internals') })
  app.use(errorHandler)
  return app
}

describe('error middleware', () => {
  it('ZodError -> 400 with issues', async () => {
    const res = await request(errApp()).post('/zod').send({ n: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details[0].path).toEqual(['n'])
  })
  it('valid body passes validate()', async () => {
    expect((await request(errApp()).post('/zod').send({ n: 1 })).status).toBe(200)
  })
  it('AppError -> its status, code, details', async () => {
    const res = await request(errApp()).get('/app')
    expect(res.status).toBe(418)
    expect(res.body).toEqual({ error: { code: 'TEAPOT', message: 'short and stout', details: { a: 1 } } })
  })
  it('async AppError reaches the handler (Express 5)', async () => {
    expect((await request(errApp()).get('/async')).status).toBe(409)
  })
  it('23505 -> 409 with the duplicate key parsed from detail', async () => {
    const res = await request(errApp()).get('/pg23505')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DUPLICATE')
    expect(res.body.error.details).toEqual({ constraint: 'properties_property_no_uq', key: '2026-09ICT-0199' })
  })
  it('23503 and 23514 -> 400', async () => {
    expect((await request(errApp()).get('/pg23503')).status).toBe(400)
    const res = await request(errApp()).get('/pg23514')
    expect(res.status).toBe(400)
    expect(res.body.error.details.constraint).toBe('lines_qty_positive')
  })
  it('anything else -> 500 with a generic message', async () => {
    const res = await request(errApp()).get('/boom')
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('secret internals')
  })
})
