# ccq

[![Build Status](https://travis-ci.org/grofers/ccq.svg?branch=master)](https://travis-ci.org/grofers/ccq)

**Javascript queues with concurrency control!**

You can think of a controlled-concurrency queue as an array of tasks with a positive concurrency *n*, which means that at any given time, at most *n* of the queued tasks are being executed concurrently, while the rest are either waiting to commence execution, or have finished executing.

## Installation

If you use NPM, use `npm install ccq`. Otherwise, download the latest release. AMD, CommonJS, and vanilla environments are supported. In vanilla, a `Queue` global is exported:

```html
<script src="https://github.com/grofers/ccq/releases/download/v0.1.0/ccq-0.1.0.min.js"></script>
<script>
    var queue = new Queue();
</script>
```

[Try **ccq** in your browser](https://npm.runkit.com/ccq) or take a look at the demo at [https://bl.ocks.org/cdax/2d694bcef87643fdee747734c4d97b1b](https://bl.ocks.org/cdax/2d694bcef87643fdee747734c4d97b1b)

## The Queue API

#### `var queue = new Queue(n);`

This constructor function creates a new queue with a concurrency of `n`. You may add as many tasks to the queue as needed, but no more than `n` of these tasks are allowed to execute concurrently at any given time. If no `n` is passed, we get a queue with unbounded concurrency.

```javascript
var Queue = require("ccq").Queue;

// creates a new queue with a concurrency of 5
var q = new Queue(5);
```


#### `queue.add(task[, taskArgs...]);`

The `add()` method adds a new task to the queue. At this point, if the queue concurrency hasn't been reached, then `task` is invoked immediately with the arguments `taskArgs`. Otherwise, `task` is added to a list of tasks already waiting to be executed. Therefore, once a task has been added to the queue, it may exist in one of 3 mutually exclusive states at any given time: **ACTIVE**, **WAITING** or **COMPLETED**.

Each task is also passed a `callback(error, results)` function as its last argument. The task **must** call this function once it has finished executing, to inform the queue of its completion. In case of a successfull completion, the `error` argument passed to the `callback` **must** be `null`, and the `results` argument must contain a single value containing the result of the function execution.

```javascript
// adds a new `uploadFile` task to the queue
queue.add(uploadFile, files[i]);
```

#### `queue.await(callback);`

Finally, the `await()` method can be used to tell the queue that no further tasks will be added to it, and that the `callback` function must be invoked once all the tasks have finished executing. This callback will be invoked with a list (`results`) of exceptions or return values from every task. The elements in `results` will match the order in which their corresponding tasks were added to the queue. For exceptions, the `isError` flag of the `result` element will be set. Result data (exception or return value) is available in `result.data`.

```javascript
// the callback passed to `.await()` will be invoked once all the tasks have finished
queue.await(function(results) {
    var failedUploads = results.filter(function (result) { return result.isError; });
    console.log(
        'Finished uploading. '
        + (results.length - failedUploads.length) + ' successful, '
        + failedUploads.length + ' failed.'
    );
});
```