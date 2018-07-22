let rp = require('request-promise');
const sequential = require('promise-sequential');
let PackageModel = require('../models/package.model');
let Graph = require('graphlib').Graph;
let graphlib = require('graphlib');
let queue = require('queue');

const getPackageUrl = (name, version) => {
  if (version) {
    return `https://registry.npmjs.org/${name}/${version}`;
  }
  return `https://registry.npmjs.org/${name}/latest`;
};

const getDependencyVersionNumber = (str) => str.replace(/[^\d\.]/g, "");

const getDepsObjectArray = (dependencies) => {
    return Object.keys(dependencies).map(name => {
        const version = getDependencyVersionNumber(dependencies[name]);
        return buildDependencyModelItem(name, version);
    });
}

function buildDependencyModelItem(name, version) {
    return {
        name,
        version: version,
        dependencies: [],
        level: 0,
        inDb: false,
        req: () => rp({
            uri: getPackageUrl(name, version),
            json: true
        }),
        reqFallback: () => rp({
            uri: getPackageUrl(name),
            json: true
        })
    };
}

function weight(e) { return 1; }

exports.SearchPackage = async (name, version) => PackageModel.searchPackage(name, version);

exports.CreatePackageGraph = async (name, version) => {

  let g = new Graph({ directed: true, compound: true, multigraph: false });
  let node = buildDependencyModelItem(name, version);

  let key = getPackageKey(name, version);
  const rootKey = key;
  g.setNode(key, node);

  let packagesExistAlredy = await PackageModel.getBatch([g.node(key)]);

  if (packagesExistAlredy.length === 1) {
    return true;
  }

  let requestArray = queue();
  requestArray.push(node);
  while (requestArray.length > 0)
  {
    let res = await getDependcyRequestResult(requestArray);

    const { name, version, dependencies } = res;
    const parentKey = getPackageKey(name,version);

    if (!dependencies) {
      continue;
    }

    const deps = getDepsObjectArray(dependencies);
    packagesExistAlredy = await PackageModel.getBatch(deps);

    deps.forEach((item) => {
      // Create nodes and add edges
      key = getPackageKey(item.name, item.version);
      // Check if packages already exist on the db (name and version) so we don't need to add them just add them to the graph.
      isPackageExist = packagesExistAlredy.filter(x => x.name === item.key && x.version === item.version);
      if (isPackageExist.length === 0) {
        node = item;
        g.setNode(key, node);
        requestArray.push(item);
      } else {
        node.inDb = true;
        g.setNode(key, isPackageExist[0]);
      }
      g.setParent(key, parentKey);
      g.setEdge(parentKey, key);
    });
  }

  await insertDependencyGraphToDb(g, rootKey);

  return true;
};

function getPackageKey(name, version) {
    return `${name}@${version}`;
}

async function getDependcyRequestResult(requestArray) {
    const nodeRequest = requestArray.shift();
    let res;
    try {
        res = await nodeRequest.req();
    }
    catch (ex) {
        // For simplicty of the exercise we just assume we got version ^x.x.x so we take the latest.
        res = await nodeRequest.reqFallback();
    }
    return res;
}

async function insertDependencyGraphToDb(g, rootKey) {

    const dij = graphlib.alg.dijkstra(g, rootKey, weight);
    const sortedByDistance = Object.keys(dij).map(name => ({
        name,
        ...dij[name],
    })).sort((a, b) => b.distance - a.distance);

    //insert to database bottom up
    for (var i = sortedByDistance[0].distance; i >= 0; i--) {
        let list = sortedByDistance.filter(x => x.distance === i).map(x => g.node(x.name));
        // insert to db.
        let _list = await PackageModel.insertMany(list);
        // go over all depencies that hat parent null so he has the id of him self.
        for (item of _list) {
            // for simplicty we won't batch update ...
            for (let dep of item.dependencies) {
                if (!dep.parent) {
                    dep.parent = item.id;
                }
            }
            item = await item.save();
        }
        // go to parent and add as dependcy, and all of his depencies too.
        for (item of _list) {
            let dijItem = dij[`${item.name}@${item.version}`];
            let parentKey = dijItem.predecessor;
            let parent = g.node(parentKey);
            if (parent) {
                let dist = dijItem.distance - dij[parentKey].distance;
                let seralizedItem = item.toJSON();
                //the parent have the children depencies but the level will increase by 1 (A->B->C) so (A has C with level B->C+1)
                let deps = seralizedItem.dependencies.map(x => ({ ...x, level: x.level + 1 }));
                parent.dependencies = parent.dependencies.concat(deps);
                parent.dependencies.push({ package: item.id, parent: null, level: dist });
                parent.dependencies.sort((a, b) => a.level - b.level);
            }
        }
    }
}
