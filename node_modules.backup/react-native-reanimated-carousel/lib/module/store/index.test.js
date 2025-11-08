import { render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { GlobalStateContext, GlobalStateProvider, useGlobalState } from "./index"; // Mock react-native-reanimated

jest.mock("react-native-reanimated", () => ({
  useSharedValue: jest.fn(initialValue => ({
    value: initialValue
  }))
}));
describe("GlobalStateProvider", () => {
  const mockProps = {
    width: 300,
    height: 200,
    data: [1, 2, 3],
    renderItem: () => /*#__PURE__*/React.createElement(Text, null, "Item")
  };
  const mockCommon = {
    size: 300,
    validLength: 3
  };
  const mockValue = {
    props: mockProps,
    common: mockCommon
  };
  it("should render children correctly", () => {
    const {
      getByText
    } = render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(Text, null, "Test Child")));
    expect(getByText("Test Child")).toBeTruthy();
  });
  it("should provide context value with layout methods", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(contextValue).toHaveProperty("props");
    expect(contextValue).toHaveProperty("common");
    expect(contextValue).toHaveProperty("layout");
    expect(contextValue.layout).toHaveProperty("containerSize");
    expect(contextValue.layout).toHaveProperty("itemDimensions");
    expect(contextValue.layout).toHaveProperty("updateItemDimensions");
    expect(contextValue.layout).toHaveProperty("updateContainerSize");
  });
  it("should initialize containerSize with default values", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(contextValue.layout.containerSize.value).toEqual({
      width: 0,
      height: 0
    });
  });
  it("should initialize itemDimensions with empty object", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(contextValue.layout.itemDimensions.value).toEqual({});
  });
  it("should provide updateItemDimensions function", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(typeof contextValue.layout.updateItemDimensions).toBe("function"); // Test the function

    contextValue.layout.updateItemDimensions(0, {
      width: 100,
      height: 50
    });
    expect(contextValue.layout.itemDimensions.value).toEqual({
      0: {
        width: 100,
        height: 50
      }
    });
  });
  it("should provide updateContainerSize function", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(typeof contextValue.layout.updateContainerSize).toBe("function"); // Test the function

    contextValue.layout.updateContainerSize({
      width: 400,
      height: 300
    });
    expect(contextValue.layout.containerSize.value).toEqual({
      width: 400,
      height: 300
    });
  });
  it("should merge props and common with layout", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(contextValue.props).toEqual(mockProps);
    expect(contextValue.common).toEqual(mockCommon);
  });
  it("should handle multiple children", () => {
    const {
      getByText
    } = render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(Text, null, "First Child"), /*#__PURE__*/React.createElement(Text, null, "Second Child")));
    expect(getByText("First Child")).toBeTruthy();
    expect(getByText("Second Child")).toBeTruthy();
  });
  it("should handle updateItemDimensions with multiple items", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null))); // Add multiple items

    contextValue.layout.updateItemDimensions(0, {
      width: 100,
      height: 50
    });
    contextValue.layout.updateItemDimensions(1, {
      width: 120,
      height: 60
    });
    contextValue.layout.updateItemDimensions(2, {
      width: 90,
      height: 45
    });
    expect(contextValue.layout.itemDimensions.value).toEqual({
      0: {
        width: 100,
        height: 50
      },
      1: {
        width: 120,
        height: 60
      },
      2: {
        width: 90,
        height: 45
      }
    });
  });
});
describe("useGlobalState", () => {
  const mockValue = {
    props: {
      width: 300,
      data: [1, 2, 3],
      renderItem: () => /*#__PURE__*/React.createElement(Text, null, "Item")
    },
    common: {
      size: 300,
      validLength: 3
    }
  };
  it("should return context value when used within provider", () => {
    let hookResult;

    const TestComponent = () => {
      hookResult = useGlobalState();
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(hookResult).toHaveProperty("props");
    expect(hookResult).toHaveProperty("common");
    expect(hookResult).toHaveProperty("layout");
  });
  it("should provide expected hook functionality", () => {
    // Test that hook returns context when used correctly
    let hookResult;

    const TestComponent = () => {
      const context = useGlobalState();
      hookResult = context;
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    const mockValue = {
      props: {
        width: 300,
        data: [1, 2, 3],
        renderItem: () => /*#__PURE__*/React.createElement(Text, null, "Item")
      },
      common: {
        size: 300,
        validLength: 3
      }
    };
    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(hookResult).toHaveProperty("props");
    expect(hookResult).toHaveProperty("common");
    expect(hookResult).toHaveProperty("layout");
  });
  it("should return the same context value as directly accessing context", () => {
    let hookResult;
    let contextResult;

    const TestComponent = () => {
      hookResult = useGlobalState();
      contextResult = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(hookResult).toBe(contextResult);
  });
  it("should provide all expected properties", () => {
    let hookResult;

    const TestComponent = () => {
      hookResult = useGlobalState();
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(GlobalStateProvider, {
      value: mockValue
    }, /*#__PURE__*/React.createElement(TestComponent, null)));
    expect(hookResult.props).toEqual(mockValue.props);
    expect(hookResult.common).toEqual(mockValue.common);
    expect(hookResult.layout).toHaveProperty("containerSize");
    expect(hookResult.layout).toHaveProperty("itemDimensions");
    expect(hookResult.layout).toHaveProperty("updateItemDimensions");
    expect(hookResult.layout).toHaveProperty("updateContainerSize");
  });
});
describe("GlobalStateContext", () => {
  it("should have default empty context value", () => {
    let contextValue;

    const TestComponent = () => {
      contextValue = React.useContext(GlobalStateContext);
      return /*#__PURE__*/React.createElement(Text, null, "Test");
    };

    render( /*#__PURE__*/React.createElement(TestComponent, null));
    expect(contextValue).toEqual({});
  });
});
//# sourceMappingURL=index.test.js.map