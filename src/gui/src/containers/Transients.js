import React, { Component, PureComponent, Fragment } from 'react'
import { FixedSizeList as List } from 'react-window'
import { isError } from 'lodash'

import http from '../lib/http'

const transformKey = (x) => {
  const [
    prefix,
    type,
    role,
    key,
  ] = x.split('|')

  return ({ prefix, type, role, key, original: x })
}

class Row extends PureComponent {
  render() {
    const { index, style, data } = this.props;
    const evenOdd = index % 2 ? 'even' : 'odd'
    const { list, selected, toggleSelection, deleteItem } = data
    const transient = list[index]
    const { prefix, type, role, key, original } = transient.key

    return (
      <div className={`ListItem ${selected.indexOf(index) > -1 && 'selected'} ${evenOdd}`} style={style}>
        {transient ? (
          <div className="tl-row">
            <span>{prefix}</span>
            <span>{type}</span>
            <span>{role}</span>
            <span onClick={(e) => toggleSelection(index, e)}>{key}</span>
            <button aria-label="Delete" onClick={(e) => deleteItem(original)}>&times;</button>
          </div>
        ) : (
          <p>Loading...</p>
        )}
      </div>
    );
  }
}

export default class Transients extends Component {
  ref = React.createRef()

  state = {
    width: 0, // window.innerWidth - 100,
    height: 0, // window.innerHeight - 100,
    list: {
      current: [],
      full: [],
      selected: [],
    },
    prefixes: [],
    types: [],
    roles: [],
    filters: {
      prefix: 'all',
      type: 'all',
      role: 'all',
      key: '',
    },
    transientsEnabled: true,
  }

  setListHeight = () => {
    const container = this.ref && this.ref.current

    if(container) {
      const { width, height } = container.getBoundingClientRect()
      this.setState({
        width: Math.round(width),
        height: Math.round(height),
      })
    }
  }

  async componentDidMount() {
    this.setListHeight()
    window.addEventListener('resize', this.setListHeight)

    const listResponse = await http('/wp-json/k1/v1/transientlist')
    const { enabled: transientsEnabled } = await http('/wp-json/k1/v1/transients')

    if (isError(listResponse)) {
      throw listResponse
    }

    const list = Object.entries(listResponse).reduce((acc, [key, data]) => {
      acc.push({ key: transformKey(key), data })

      return acc
    }, [])

    const { prefixes, types, roles } = list.reduce((acc, { key, data }) => {
      if (!acc.prefixes.includes(key.prefix)) {
        acc.prefixes.push(key.prefix)
      }

      if (!acc.types.includes(key.type)) {
        acc.types.push(key.type)
      }

      if (!acc.roles.includes(key.role)) {
        acc.roles.push(key.role)
      }

      return acc
    }, { prefixes: [], types: [], roles: [] })


    this.setState({
      list: {
        current: list,
        full: list,
        selected: [],
      },
      prefixes,
      types,
      roles,
      transientsEnabled,
    })
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.setListHeight)
  }

  reorder = () => {
    const { list, filters } = this.state
    const { full } = list

    const requireAll = predicates => subject => predicates.every(f => f(subject))
    const byColumn = name => ({ key }) => key[name] === filters[name]
    const byKey = regex => ({ key }) => key.original.match(regex)

    const filterableColumns = ["type", "role", "prefix"]

    let selectBy = filterableColumns
      .filter(name => filters[name] !== "all")
      .map(byColumn)

    if (filters.key !== "") {
      selectBy.push(byKey(filters.key))
    }

    this.setState({
      list: {
        ...this.state.list,
        current: full.filter(requireAll(selectBy)),
        selected: [],
      }
    })
  }

  select = (by, e) => {
    this.setState({
      filters: {
        ...this.state.filters,
        [by]: e.target.value,
      }
    }, this.reorder)
  }

  delete = async (transientKey) => {
    const result = await http('/wp-json/k1/v1/transientlist/delete', {
      body: { transientKey },
      method: 'POST'
    })

    if (isError(result)) {
      throw result
    }

    const newList = this.state.list.full.filter(({ key }) => key.original !== transientKey)

    this.setState({
      list: {
        ...this.state.list,
        full: newList,
      }
    }, this.reorder)

    return result
  }

  deleteSelected = () => {
    const { list } = this.state
    const { selected, current } = list

    const toBeDeleted = selected.map(i => current[i])

    toBeDeleted.forEach(({ key }) => this.delete(key.original))
    this.clearSelection()
  }

  /**
   * This works but eh; overlapping an already selected area fucks everything up
   */
  toggleSelection = (index, e = {}) => {
    const shiftPressed = e.shiftKey
    let newSelection = [...this.state.list.selected]

    const lastSelection = newSelection.length && newSelection[newSelection.length - 1]
    const oldPos = newSelection.indexOf(index)

    if (oldPos > -1) {
      newSelection = newSelection.filter((_, i) => i !== oldPos)
    } else {
      newSelection = [...newSelection, index]
    }

    if (shiftPressed) {
      if (index < lastSelection) {
        const rowsToToggle = lastSelection - index - 1

        for (let i = 0; i < rowsToToggle; i++) {
          const number = index + i + 1
          const oldPos = newSelection.indexOf(number)

          if (oldPos > -1) {
            newSelection = newSelection.filter((_, i) => i !== oldPos)
          } else {
            newSelection = [...newSelection, number]
          }
        }
      } else if (index > lastSelection) {
        const rowsToToggle = index - lastSelection - 1

        for (let i = 0; i < rowsToToggle; i++) {
          const number = index - i - 1
          const oldPos = newSelection.indexOf(number)

          if (oldPos > -1) {
            newSelection = newSelection.filter((_, i) => i !== oldPos)
          } else {
            newSelection = [...newSelection, number]
          }
        }
      }
    }

    this.setState({
      list: {
        ...this.state.list,
        selected: newSelection,
      }
    })
  }

  clearSelection = () => {
    this.setState({
      list: {
        ...this.state.list,
        selected: [],
      }
    })
  }

  toggleTransients = async () => {
    const active = this.state.transientsEnabled

    try {
      if (active) {
        await http('/wp-json/k1/v1/transients/disable', { method: 'post' })
      } else {
        await http('/wp-json/k1/v1/transients/enable', { method: 'post' })
      }

      this.setState({
        transientsEnabled: !active
      })
    } catch (e) {
      console.error(e)
    }

  }

  renderOption = (x) => (
    <option key={x} value={x}>
      {x}
    </option>
  )


  render() {
    const { width, height, list, types, prefixes, roles, transientsEnabled } = this.state
    const { current: currentList, selected } = list

    return (
      <div className="transients">
        <div className="info">
          <h2>Transients</h2>

          <label>
            <input type="checkbox" onChange={this.toggleTransients} checked={!transientsEnabled} />

            <strong>Disable k1\Transientify transients?</strong>
          </label>

          <p>Manage transients within TransientList.</p>
          <p>Only transients created with \k1\Transientify, or managed by \k1\TransientList will show up here.</p>

          {Boolean(selected.length) && (
            <Fragment>
              <p>Do you want to delete the selected transients?</p>

              <button onClick={this.deleteSelected} className="button button-link-delete">
                Yes, delete
              </button>&nbsp;

              <button onClick={this.clearSelection} className="button">
                No, cancel selection
              </button>
            </Fragment>
          )}
        </div>

        <div className="list-container" ref={this.ref}>
          <div className="tl-row header" style={{ width: `${width}px` }}>
            <select onChange={(e) => this.select('prefix', e)}>
              <option value="all">All prefixes</option>
              {prefixes.map(this.renderOption)}
            </select>
            <select onChange={(e) => this.select('type', e)}>
              <option value="all">All types</option>
              {types.map(this.renderOption)}
            </select>
            <select onChange={(e) => this.select('role', e)}>
              <option value="all">All roles</option>
              {roles.map(this.renderOption)}
            </select>
            <input type="text" name="key" onChange={(e) => this.select('key', e)} placeholder="Key" />
            <span aria-label="Quick actions"></span>
          </div>

          <List
            className="List"
            height={height}
            itemCount={currentList.length}
            itemSize={45}
            itemData={{ list: currentList, selected, toggleSelection: this.toggleSelection, deleteItem: this.delete }}
            width={width}
          >
            {Row}
          </List>
        </div>
      </div>
    )
  }
}
