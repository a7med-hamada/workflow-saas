@echo off
call "%~dp0run-node.cmd" --test "%~dp0tests\workflow.test.js" %*
