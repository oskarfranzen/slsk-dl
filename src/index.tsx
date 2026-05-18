#!/usr/bin/env node
import './config.js' // loads dotenv first
import React from 'react'
import { render } from 'ink'
import { App } from './app.js'

render(<App />)
