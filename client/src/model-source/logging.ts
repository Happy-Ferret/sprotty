/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject } from "inversify"
import { ILogger, LogLevel } from "../utils/logging"
import { TYPES } from "../base/types"
import { Action } from "../base/actions/action"
import { ModelSource } from "./model-source"

export class LoggingAction implements Action {
    static readonly KIND = 'logging'
    readonly kind = LoggingAction.KIND

    constructor(public readonly severity: string,
                public readonly time: string,
                public readonly caller: string,
                public readonly message: string,
                public readonly params: string[]) {
    }
}

/**
 * A logger that forwards messages of type 'error', 'warn', and 'info' to the model source.
 */
@injectable()
export class ForwardingLogger implements ILogger {
    constructor(@inject(TYPES.ModelSourceProvider) protected modelSourceProvider: () => Promise<ModelSource>,
                @inject(TYPES.LogLevel) public logLevel: LogLevel) {}

    error(thisArg: any, message: string, ...params: any[]): void {
        if (this.logLevel >= LogLevel.error)
            this.forward(thisArg, message, LogLevel.error, params)
    }

    warn(thisArg: any, message: string, ...params: any[]): void {
        if (this.logLevel >= LogLevel.warn)
            this.forward(thisArg, message, LogLevel.warn, params)
    }

    info(thisArg: any, message: string, ...params: any[]): void {
        if (this.logLevel >= LogLevel.info)
            this.forward(thisArg, message, LogLevel.info, params)
    }

    log(thisArg: any, message: string, ...params: any[]): void {
        if (this.logLevel >= LogLevel.log) {
            // We cannot forward 'log' level messages since that would lead to endless loops
            try {
                const caller = typeof thisArg === 'object' ? thisArg.constructor.name : String(thisArg)
                console.log.apply(thisArg, [caller + ': ' + message, ...params])
            } catch (error) {}
        }
    }

    protected forward(thisArg: any, message: string, logLevel: LogLevel, params: any[]) {
        const date = new Date()
        const action = new LoggingAction(
            LogLevel[logLevel],
            date.toLocaleTimeString(),
            typeof thisArg === 'object' ? thisArg.constructor.name : String(thisArg),
            message,
            params.map(p => JSON.stringify(p))
        )
        this.modelSourceProvider().then(modelSource => {
            try {
                modelSource.handle(action)
            } catch (error) {
                try {
                    console.log.apply(thisArg, [message, action, error])
                } catch (error) {}
            }
        })
    }
}
