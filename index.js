
function Queue(concurrency) {
    // maximum number of tasks that are allowed to execute concurrently
    if (typeof concurrency === 'undefined' || concurrency == null) {
        concurrency = Infinity;
    } else if (!((concurrency = +concurrency) >= 1)) {
        throw new Error("Invalid concurrency.");
    }
    this._concurrency = concurrency;
    // list of tasks
    this._tasks = [];
    // list of task results (errors and return values)
    this._results = [];
    // to track whether await callback was invoked
    this._awaitCallbackInvoked = false;
    // counters to keep track of tasks in each of the 3 states: WAITING, ACTIVE, or COMPLETED
    this._numWaiting = this._numActive = this._numCompleted = 0;
    // callback to invoke when all tasks have finished executing
    this._awaitCallback = null;
}

Queue.prototype.add = function add(task) {
    // error if `task` is not a function
    if(typeof task !== 'function') {
        throw new Error('Invalid task.');
    }
    // error if an `.await()` callback has already been set
    if(this._awaitCallback) {
        throw new Error('`.await()` has already been called.');
    }
    var taskArgs = Array.prototype.slice.call(arguments, 1);
    // add this task to the list of waiting tasks
    this._tasks.push([task, taskArgs]);
    this._numWaiting += 1;
    // start executing queued tasks
    startNextTask(this);
    // to enable chaining
    return this;
};

Queue.prototype.await = function await(callback) {
    // error if `callback` is not a function
    if (typeof callback !== 'function') {
        throw new Error('Invalid callback.');
    }
    // error if an `_awaitCallback` has already been set
    if (this._awaitCallback) {
        throw new Error('Queue execution has already started.');
    }
    this._awaitCallback = callback;
    // all queued tasks might already have finished executing, so try to invoke `_awaitCallback`
    callAwaitCallback(this);
    // to enable chaining
    return this;
};

function callAwaitCallback(queue) {
    // call the await callback only if it exists, and if no tasks are currently executing or waiting
    if(queue._awaitCallback && !queue._awaitCallbackInvoked && !queue._numWaiting && !queue._numActive) {
        var results = queue._results;
        queue._awaitCallbackInvoked = true;
        queue._awaitCallback(results);
        queue._results = undefined;
    }
}

var noabort = {
    isError: null
};

function startNextTask(queue) {
    // start a new waiting task only if there are any, and if the queue concurrency hasn't been reached
    while(queue._numWaiting && queue._numActive < queue._concurrency) {
        // the next waiting task is at the index `q._numActive + q._numCompleted`
        var taskIndex = queue._numActive + queue._numCompleted;
        var task = queue._tasks[taskIndex],
            taskFunction = task[0],
            taskArgs = task[1];
        // create a new callback method that updates the queue upon task completion
        // pass this method as the last argument to the task
        taskArgs.push(getTaskCallback(queue, taskIndex));
        // update the counter variables to reflect the movement of a task from the WAITING to the ACTIVE state
        queue._numWaiting -= 1;
        queue._numActive += 1;
        // execute the task
        try {
            taskFunction.apply(null, taskArgs);
        } catch(error) {
            if (queue._tasks[taskIndex]) {
                // task errored synchronously
                queue._results[taskIndex] = {
                    isError: true,
                    data: error,
                };
                // update the counter variables to reflect the movement of a task from the WAITING to the ACTIVE state
                queue._numActive -= 1;
                queue._numCompleted += 1;
                callAwaitCallback(queue);
            } else if(queue._awaitCallbackInvoked) {
                // await callback errored synchronously
                throw error;
            }
        }
    }
}

function getTaskCallback(queue, taskIndex) {
    return function taskCallback(error, results) {
        if(!queue._tasks[taskIndex]) return;
        // update the counter variables to reflect the movement of a task from the WAITING to the ACTIVE state
        queue._numActive -= 1;
        queue._numCompleted += 1;
        // since the `_tasks` array is set to `null` at `taskIndex` only inside this callback,
        // we can use this information to test whether `task` was executed synchronously or asynchronously
        queue._tasks[taskIndex] = null;
        // update the `_results` array
        // this array will be passed to `_awaitCallback`
        if(error != null) {
            queue._results[taskIndex] = {
                isError: true,
                data: error,
            };
        } else {
            queue._results[taskIndex] = {
                isError: false,
                data: results,
            };
        }
        if(queue._numWaiting) {
            // if there are any waiting tasks left, execute them
            startNextTask(queue);
        } else {
            // otherwise, call the await callback (if any)
            callAwaitCallback(queue);
        }
    }
}


(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
    return {
        Queue: Queue,
    };
}));