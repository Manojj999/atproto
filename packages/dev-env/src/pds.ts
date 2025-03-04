import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import getPort from 'get-port'
import * as ui8 from 'uint8arrays'
import * as pds from '@atproto/pds'
import { createSecretKeyObject } from '@atproto/pds/src/auth-verifier'
import { Secp256k1Keypair, randomStr } from '@atproto/crypto'
import { AtpAgent } from '@atproto/api'
import { PdsConfig } from './types'
import {
  ADMIN_PASSWORD,
  JWT_SECRET,
  MOD_PASSWORD,
  TRIAGE_PASSWORD,
} from './const'

export class TestPds {
  constructor(
    public url: string,
    public port: number,
    public server: pds.PDS,
  ) {}

  static async create(config: PdsConfig): Promise<TestPds> {
    const plcRotationKey = await Secp256k1Keypair.create({ exportable: true })
    const plcRotationPriv = ui8.toString(await plcRotationKey.export(), 'hex')
    const recoveryKey = (await Secp256k1Keypair.create()).did()

    const port = config.port || (await getPort())
    const url = `http://localhost:${port}`

    const blobstoreLoc = path.join(os.tmpdir(), randomStr(8, 'base32'))
    const dataDirectory = path.join(os.tmpdir(), randomStr(8, 'base32'))
    await fs.mkdir(dataDirectory, { recursive: true })

    const env: pds.ServerEnvironment = {
      port,
      dataDirectory: dataDirectory,
      blobstoreDiskLocation: blobstoreLoc,
      recoveryDidKey: recoveryKey,
      adminPassword: ADMIN_PASSWORD,
      moderatorPassword: MOD_PASSWORD,
      triagePassword: TRIAGE_PASSWORD,
      jwtSecret: JWT_SECRET,
      serviceHandleDomains: ['.test'],
      bskyAppViewUrl: 'https://appview.invalid',
      bskyAppViewDid: 'did:example:invalid',
      bskyAppViewCdnUrlPattern: 'http://cdn.appview.com/%s/%s/%s',
      plcRotationKeyK256PrivateKeyHex: plcRotationPriv,
      inviteRequired: false,
      ...config,
    }
    const cfg = pds.envToCfg(env)
    const secrets = pds.envToSecrets(env)

    const server = await pds.PDS.create(cfg, secrets)

    await server.start()

    return new TestPds(url, port, server)
  }

  get ctx(): pds.AppContext {
    return this.server.ctx
  }

  getClient(): AtpAgent {
    return new AtpAgent({ service: `http://localhost:${this.port}` })
  }

  adminAuth(role: 'admin' | 'moderator' | 'triage' = 'admin'): string {
    const password =
      role === 'triage'
        ? TRIAGE_PASSWORD
        : role === 'moderator'
        ? MOD_PASSWORD
        : ADMIN_PASSWORD
    return (
      'Basic ' +
      ui8.toString(ui8.fromString(`admin:${password}`, 'utf8'), 'base64pad')
    )
  }

  adminAuthHeaders(role?: 'admin' | 'moderator' | 'triage') {
    return {
      authorization: this.adminAuth(role),
    }
  }

  jwtSecretKey() {
    return createSecretKeyObject(JWT_SECRET)
  }

  async processAll() {
    await this.ctx.backgroundQueue.processAll()
  }

  async close() {
    await this.server.destroy()
  }
}
