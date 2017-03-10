import {EventLoop} from "../../base"
import {CommandStack, ActionDispatcher, SetModelAction, SelectKind, SelectCommand} from "../../base/intent"
import {Viewer} from "../../base/view"
import {GChip} from "./gmodel"
import {GChipView, GCoreView, GChannelView, GCrossbarView} from "./views"
import {GCoreSchema, GChannelSchema} from "./schema"
import {Direction} from "../../utils/geometry"
import XUnit = Mocha.reporters.XUnit

export default function runMulticore() {
    // init gmodel
    const dim = 4
    const cores: GCoreSchema[] = []
    const channels: GChannelSchema[] = []
    for (let i = 0; i < dim; ++i) {
        for (let j = 0; j < dim; ++j) {
            const pos = i + '_' + j
            cores.push({
                id: 'core_' + pos,
                type: 'core',
                column: i,
                row: j
            })
            const channelData = {
                id: 'channel_' + pos,
                type: 'channel',
                column: i,
                row: j,
                throughput: Math.random(),
            }
            channels.push(createChannel(i, j, Direction.up))
            channels.push(createChannel(i, j, Direction.down))
            channels.push(createChannel(i, j, Direction.left))
            channels.push(createChannel(i, j, Direction.right))
        }
        channels.push(createChannel(dim, i, Direction.up))
        channels.push(createChannel(dim, i, Direction.down))
        channels.push(createChannel(i, dim, Direction.left))
        channels.push(createChannel(i, dim, Direction.right))
    }

    function createChannel(row: number, column: number, direction: Direction): GChannelSchema {
        const pos = row + '_' + column
        return {
            id: 'channel_' + pos,
            type: 'channel',
            column: column,
            row: row,
            direction: direction,
            throughput: Math.random(),
        }
    }

    const crossbars = [{
        id: 'cb_up',
        type: 'crossbar',
        direction: Direction.up
    }, {
        id: 'cb_down',
        type: 'crossbar',
        direction: Direction.down
    }, {
        id: 'cb_left',
        type: 'crossbar',
        direction: Direction.left
    }, {
        id: 'cb_right',
        type: 'crossbar',
        direction: Direction.right

    }]
    const chip = new GChip({
        id: 'chip',
        type: 'chip',
        rows: dim,
        columns: dim,
        cores: cores,
        channels: channels,
        crossbars: crossbars
    })

    // setup event loop
    const eventLoop = new EventLoop(
        new ActionDispatcher(),
        new CommandStack(),
        new Viewer('sprotte')
    );

    eventLoop.dispatcher.registerCommand(SelectKind, SelectCommand)

    // register views
    const viewComponentRegistry = eventLoop.viewer.viewRegistry
    viewComponentRegistry.register('chip', GChipView)
    viewComponentRegistry.register('core', GCoreView)
    viewComponentRegistry.register('crossbar', GCrossbarView)
    viewComponentRegistry.register('channel', GChannelView)

    // run
    const action = new SetModelAction(chip);
    eventLoop.dispatcher.dispatch(action);
}