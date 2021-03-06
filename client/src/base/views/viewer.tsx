/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as snabbdom from "snabbdom-jsx";
import { init } from "snabbdom";
import { VNode } from "snabbdom/vnode";
import { Module } from "snabbdom/modules/module";
import { propsModule } from "snabbdom/modules/props";
import { attributesModule } from "snabbdom/modules/attributes";
import { styleModule } from "snabbdom/modules/style";
import { eventListenersModule } from "snabbdom/modules/eventlisteners";
import { classModule } from "snabbdom/modules/class";
import { inject, injectable, multiInject, optional } from "inversify";
import { TYPES } from "../types";
import { ILogger } from "../../utils/logging";
import { ORIGIN_POINT } from "../../utils/geometry";
import { SModelElement, SModelRoot, SParentElement } from "../model/smodel";
import { IActionDispatcher } from "../actions/action-dispatcher";
import { InitializeCanvasBoundsAction } from "../features/initialize-canvas";
import { IVNodeDecorator } from "./vnode-decorators";
import { RenderingContext, ViewRegistry } from "./view";
import { setClass, setAttr, copyClassesFromElement, copyClassesFromVNode } from "./vnode-utils";
import { ViewerOptions } from "./viewer-options";
import { isThunk } from "./thunk-view";
import { EMPTY_ROOT } from "../model/smodel-factory";

const JSX = {createElement: snabbdom.html};  // must be html here, as we're creating a div

export interface IViewer {
    update(model: SModelRoot): void
    updateHidden(hiddenModel: SModelRoot): void
    updatePopup(popupModel: SModelRoot): void
}

export class ModelRenderer implements RenderingContext {

    constructor(public viewRegistry: ViewRegistry,
                private decorators: IVNodeDecorator[]) {
    }

    decorate(vnode: VNode, element: Readonly<SModelElement>): VNode {
        if (isThunk(vnode))
            return vnode;
        return this.decorators.reduce(
            (n: VNode, decorator: IVNodeDecorator) => decorator.decorate(n, element),
            vnode);
    }

    renderElement(element: Readonly<SModelElement>, args?: object): VNode {
        const vNode = this.viewRegistry.get(element.type, undefined).render(element, this, args);
        return this.decorate(vNode, element);
    }

    renderChildren(element: Readonly<SParentElement>, args?: object): VNode[] {
        return element.children.map((child) => this.renderElement(child, args));
    }

    postUpdate() {
        this.decorators.forEach(decorator => decorator.postUpdate());
    }
}

export type ModelRendererFactory = (decorators: IVNodeDecorator[]) => ModelRenderer;

/**
 * The component that turns the model into an SVG DOM.
 * Uses a VDOM based on snabbdom.js for performance.
 */
@injectable()
export class Viewer implements IViewer {

    protected renderer: ModelRenderer;
    protected hiddenRenderer: ModelRenderer;
    protected popupRenderer: ModelRenderer;

    protected readonly patcher: Patcher;

    protected lastVDOM: VNode;
    protected lastHiddenVDOM: VNode;
    protected lastPopupVDOM: VNode;

    constructor(@inject(TYPES.ModelRendererFactory) modelRendererFactory: ModelRendererFactory,
                @multiInject(TYPES.IVNodeDecorator) @optional() protected decorators: IVNodeDecorator[],
                @multiInject(TYPES.HiddenVNodeDecorator) @optional() protected hiddenDecorators: IVNodeDecorator[],
                @multiInject(TYPES.PopupVNodeDecorator) @optional() protected popupDecorators: IVNodeDecorator[],
                @inject(TYPES.ViewerOptions) protected options: ViewerOptions,
                @inject(TYPES.ILogger) protected logger: ILogger,
                @inject(TYPES.IActionDispatcher) protected actiondispatcher: IActionDispatcher) {
        this.patcher = this.createPatcher();
        this.renderer = modelRendererFactory(decorators);
        this.hiddenRenderer = modelRendererFactory(hiddenDecorators);
        this.popupRenderer = modelRendererFactory(popupDecorators);
    }

    protected createModules(): Module[] {
        return [
            propsModule,
            attributesModule,
            classModule,
            styleModule,
            eventListenersModule
        ];
    }

    protected createPatcher() {
        return init(this.createModules());
    }

    protected onWindowResize = (vdom: VNode): void => {
        const baseDiv = document.getElementById(this.options.baseDiv);
        if (baseDiv !== null) {
            const newBounds = this.getBoundsInPage(baseDiv as Element);
            this.actiondispatcher.dispatch(new InitializeCanvasBoundsAction(newBounds));
        }
    }

    protected getBoundsInPage(element: Element) {
        const bounds = element.getBoundingClientRect();
        const scroll = typeof window !== 'undefined' ? {x: window.scrollX, y: window.scrollY} : ORIGIN_POINT;
        return {
            x: bounds.left + scroll.x,
            y: bounds.top + scroll.y,
            width: bounds.width,
            height: bounds.height
        };
    }

    update(model: Readonly<SModelRoot>): void {
        this.logger.log(this, 'rendering', model);
        const newVDOM = <div id={this.options.baseDiv}>
            {this.renderer.renderElement(model)}
        </div>;
        if (this.lastVDOM !== undefined) {
            const hadFocus = this.hasFocus();
            copyClassesFromVNode(this.lastVDOM, newVDOM);
            this.lastVDOM = this.patcher.call(this, this.lastVDOM, newVDOM);
            this.restoreFocus(hadFocus);
        } else if (typeof document !== 'undefined') {
            const placeholder = document.getElementById(this.options.baseDiv);
            if (placeholder !== null) {
                if (typeof window !== 'undefined') {
                    window.addEventListener('resize', () => {
                        this.onWindowResize(newVDOM);
                    });
                }
                copyClassesFromElement(placeholder, newVDOM);
                setClass(newVDOM, this.options.baseClass, true);
                this.lastVDOM = this.patcher.call(this, placeholder, newVDOM);
            } else {
                this.logger.error(this, 'element not in DOM:', this.options.baseDiv);
            }
        }
        this.renderer.postUpdate();
    }

    protected hasFocus(): boolean {
        if (typeof document !== 'undefined' && document.activeElement && this.lastVDOM.children && this.lastVDOM.children.length > 0) {
            const lastRootVNode = this.lastVDOM.children[0];
            if (typeof lastRootVNode === 'object') {
                const lastElement = (lastRootVNode as VNode).elm;
                return document.activeElement === lastElement;
            }
        }
        return false;
    }

    protected restoreFocus(focus: boolean) {
        if (focus && this.lastVDOM.children && this.lastVDOM.children.length > 0) {
            const lastRootVNode = this.lastVDOM.children[0];
            if (typeof lastRootVNode === 'object') {
                const lastElement = (lastRootVNode as VNode).elm;
                if (lastElement && typeof (lastElement as any).focus === 'function')
                    (lastElement as any).focus();
            }
        }
    }

    updateHidden(hiddenModel: Readonly<SModelRoot>): void {
        this.logger.log(this, 'rendering hidden');

        let newVDOM: VNode;
        if (hiddenModel.type === EMPTY_ROOT.type) {
            newVDOM = <div id={this.options.hiddenDiv}></div>;
        } else {
            const hiddenVNode = this.hiddenRenderer.renderElement(hiddenModel);
            setAttr(hiddenVNode, 'opacity', 0);
            newVDOM = <div id={this.options.hiddenDiv}>
                {hiddenVNode}
            </div>;
        }

        if (this.lastHiddenVDOM !== undefined) {
            copyClassesFromVNode(this.lastHiddenVDOM, newVDOM);
            this.lastHiddenVDOM = this.patcher.call(this, this.lastHiddenVDOM, newVDOM);
        } else {
            let placeholder = document.getElementById(this.options.hiddenDiv);
            if (placeholder === null) {
                placeholder = document.createElement("div");
                document.body.appendChild(placeholder);
            } else {
                copyClassesFromElement(placeholder, newVDOM);
            }
            setClass(newVDOM, this.options.baseClass, true);
            setClass(newVDOM, this.options.hiddenClass, true);
            this.lastHiddenVDOM = this.patcher.call(this, placeholder, newVDOM);
        }
        this.hiddenRenderer.postUpdate();
    }

    updatePopup(model: Readonly<SModelRoot>): void {
        this.logger.log(this, 'rendering popup', model);

        const popupClosed = model.type === EMPTY_ROOT.type;
        let newVDOM: VNode;
        if (popupClosed) {
            newVDOM = <div id={this.options.popupDiv}></div>;
        } else {
            const position = model.canvasBounds;
            const inlineStyle = {
                top: position.y + 'px',
                left: position.x + 'px'
            };
            newVDOM = <div id={this.options.popupDiv} style={inlineStyle}>
                {this.popupRenderer.renderElement(model)}
            </div>;
        }

        if (this.lastPopupVDOM !== undefined) {
            copyClassesFromVNode(this.lastPopupVDOM, newVDOM);
            setClass(newVDOM, this.options.popupClosedClass, popupClosed);
            this.lastPopupVDOM = this.patcher.call(this, this.lastPopupVDOM, newVDOM);
        } else if (typeof document !== 'undefined') {
            let placeholder = document.getElementById(this.options.popupDiv);
            if (placeholder === null) {
                placeholder = document.createElement("div");
                document.body.appendChild(placeholder);
            } else {
                copyClassesFromElement(placeholder, newVDOM);
            }
            setClass(newVDOM, this.options.popupClass, true);
            setClass(newVDOM, this.options.popupClosedClass, popupClosed);
            this.lastPopupVDOM = this.patcher.call(this, placeholder, newVDOM);
        }
        this.popupRenderer.postUpdate();
    }
}

export type Patcher = (oldRoot: VNode | Element, newRoot: VNode) => VNode;

export type IViewerProvider = () => Promise<Viewer>;
