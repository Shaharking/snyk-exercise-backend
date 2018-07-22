const mongoose = require('mongoose');

const packageSchema =  new mongoose.Schema({
    name: { type: String, required: true },
    version: {type: String, required: true },
    dependencies: [{
         package: { type:  mongoose.Schema.Types.ObjectId, ref: 'Package'},
         parent: { type:  mongoose.Schema.Types.ObjectId, ref: 'Package'}, // Not need to be populated.
         level: { type: Number, default: 1 }
    }]

});

packageSchema.index({ name: 1, version: 1 }, { unique: true });

/**
 * Statics
 */
packageSchema.statics = {
   async getBatch(packages) {

        packagesQuery = packages.map( ({name,version}) => {
            return {name, version};
        });

        if (packagesQuery.length > 0) {        
            return this.find({$or: packagesQuery})
                        .exec();
        }
        return Promise.resolve([]);
   },
   async searchPackage(name, version) {
        const package = await this.findOne({name: name, version: version})
                    .populate('dependencies.package')
                    .exec();
        
        return unflatPopulatedModel(package)
   }
}

//Private Methods:
const unflatPopulatedModel = function(package) {
    const dependencies = {};
    const packageObject = package.toJSON();

    var len = package.dependencies.length;

    if(len == 0){
        return Object.assign(package, {dependencies:[], children: []} );
    }

    var level = packageObject.dependencies[len-1].level;
    while (level > 1) 
    {
       sameLevel = packageObject.dependencies.filter(x=> x.level === level);
       sameLevel.forEach(item => {
            const parent = packageObject.dependencies.find(x=>x.package._id.toString() == item.parent.toString());
            if(!parent.children) {
                parent.children = [];
            }
            parent.children.push(item);
            var itemIndex = packageObject.dependencies.indexOf(item);
            packageObject.dependencies.splice(itemIndex, 1);
       });
       level--;
    }
    //Make it more constant to you intreate it recusively.
    packageObject.package = {name: packageObject.name, version: packageObject.version};
    packageObject.children = packageObject.dependencies;
    delete packageObject.dependencies;
    return packageObject;
}

/**
 * @typedef Package
 */
module.exports = mongoose.model('Package', packageSchema);

