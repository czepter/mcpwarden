import { setupServer } from 'msw/node'
import { handlersFor } from './index'

export const makeServer = (spec = 'all') => setupServer(...handlersFor(spec))
